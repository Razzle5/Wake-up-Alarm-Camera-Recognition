/**
 * =======================================================
 * KONFIGURASI MODEL TEACHABLE MACHINE
 * =======================================================
 * Ganti nilai MODEL_URL di bawah ini dengan URL dari model
 * Teachable Machine yang telah Anda latih dan publish.
 * Pastikan URL diakhiri dengan garis miring (/).
 */
const MODEL_URL = "https://teachablemachine.withgoogle.com/models/Ez4B6r5os/";

// =======================================================
// DEKLARASI ELEMEN DOM
// =======================================================
const loadingDiv = document.getElementById('loading-model');
const settingsDiv = document.getElementById('alarm-settings');
const challengeDiv = document.getElementById('alarm-challenge');
const successDiv = document.getElementById('success-message');

const alarmTimeInput = document.getElementById('alarm-time');
const btnSaveAlarm = document.getElementById('btn-save-alarm');
const activeAlarmInfo = document.getElementById('active-alarm-info');
const displayAlarmTime = document.getElementById('display-alarm-time');
const btnCancelAlarm = document.getElementById('btn-cancel-alarm');
const itemList = document.getElementById('item-list');

const targetItemEl = document.getElementById('target-item');
const canvas = document.getElementById('canvas');
const confidenceBar = document.getElementById('confidence-bar');
const confidenceText = document.getElementById('confidence-text');
const btnReset = document.getElementById('btn-reset');

// =======================================================
// VARIABEL STATE
// =======================================================
let model, webcam, maxPredictions;
let classLabels = [];

let alarmTime = null;
let alarmCheckInterval = null;
let isRinging = false;
let targetLabel = "";

// Threshold untuk mendeteksi barang (80%)
const REQUIRED_CONFIDENCE = 0.80; 
// Jumlah frame berturut-turut di atas threshold untuk sukses (sekitar 1 detik pada 30fps)
const REQUIRED_FRAMES = 30; 
let consecutiveHighConfidenceCount = 0;

// Variabel untuk Audio (Web Audio API)
let audioCtx;
let beepInterval;

// =======================================================
// INISIALISASI APLIKASI
// =======================================================

// 1. Ambil pengaturan alarm yang tersimpan di localStorage
const storedAlarm = localStorage.getItem('alarmTime');
if (storedAlarm) {
    alarmTime = storedAlarm;
    alarmTimeInput.value = alarmTime;
}

// 2. Muat Model Teachable Machine
async function initModel() {
    try {
        const modelURL = MODEL_URL + "model.json";
        const metadataURL = MODEL_URL + "metadata.json";

        // Memuat model dan metadata (menggunakan async/await)
        model = await tmImage.load(modelURL, metadataURL);
        maxPredictions = model.getTotalClasses();
        classLabels = model.getClassLabels();

        // Menyaring class yang mungkin hanya 'Background' atau kosong
        const validItems = classLabels.filter(label => 
            label.toLowerCase() !== 'background' && 
            label.toLowerCase() !== 'kosong' &&
            label.toLowerCase() !== 'nothing'
        );
        
        // Memperbarui UI daftar barang yang perlu disiapkan
        itemList.innerHTML = '';
        if (validItems.length === 0) validItems.push(...classLabels); // Fallback jika semua tersaring
        
        validItems.forEach(item => {
            const li = document.createElement('li');
            li.textContent = item;
            itemList.appendChild(li);
        });

        // Sembunyikan loading, tampilkan pengaturan
        loadingDiv.classList.add('hidden');
        settingsDiv.classList.remove('hidden');
        updateAlarmUI();

        // Mulai pengecekan waktu alarm
        startAlarmChecker();
    } catch (error) {
        console.error("Gagal memuat model:", error);
        loadingDiv.innerHTML = `
            <div style="color: var(--danger-color); padding: 20px;">
                <h3>⚠️ Gagal memuat model AI</h3>
                <p style="font-size: 14px; margin-top: 10px;">Periksa koneksi internet Anda atau pastikan URL model Teachable Machine sudah benar dan dapat diakses.</p>
            </div>
        `;
    }
}

// =======================================================
// MANAJEMEN ALARM
// =======================================================

btnSaveAlarm.addEventListener('click', () => {
    // Inisialisasi Audio Context saat interaksi user (kebijakan browser modern)
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    if (!alarmTimeInput.value) {
        alert("Silakan pilih waktu alarm terlebih dahulu!");
        return;
    }
    alarmTime = alarmTimeInput.value;
    localStorage.setItem('alarmTime', alarmTime);
    updateAlarmUI();
});

btnCancelAlarm.addEventListener('click', () => {
    alarmTime = null;
    localStorage.removeItem('alarmTime');
    alarmTimeInput.value = '';
    updateAlarmUI();
});

function updateAlarmUI() {
    if (alarmTime) {
        displayAlarmTime.textContent = alarmTime;
        activeAlarmInfo.classList.remove('hidden');
        btnSaveAlarm.textContent = "Ubah Alarm Waktu";
    } else {
        activeAlarmInfo.classList.add('hidden');
        btnSaveAlarm.textContent = "Simpan Alarm";
    }
}

function startAlarmChecker() {
    if (alarmCheckInterval) clearInterval(alarmCheckInterval);
    
    // Cek setiap detik
    alarmCheckInterval = setInterval(() => {
        if (!alarmTime || isRinging) return;
        
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const currentTime = `${hours}:${minutes}`;

        // Jika waktu sekarang sama dengan waktu alarm
        if (currentTime === alarmTime) {
            triggerAlarm();
        }
    }, 1000);
}

// =======================================================
// SAAT ALARM BERBUNYI & TANTANGAN KAMERA
// =======================================================

async function triggerAlarm() {
    isRinging = true;
    settingsDiv.classList.add('hidden');
    challengeDiv.classList.remove('hidden');

    // Pilih barang secara acak dari label model
    const validItems = classLabels.filter(label => 
        label.toLowerCase() !== 'background' && 
        label.toLowerCase() !== 'kosong' &&
        label.toLowerCase() !== 'nothing'
    );
    
    const itemsToSelect = validItems.length > 0 ? validItems : classLabels;
    targetLabel = itemsToSelect[Math.floor(Math.random() * itemsToSelect.length)];
    
    targetItemEl.textContent = targetLabel;
    consecutiveHighConfidenceCount = 0;

    // Mulai suara alarm
    startBeep();
    
    // Siapkan dan nyalakan kamera
    await setupCamera();
}

function startBeep() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Mainkan suara 'beep' setiap 0.8 detik
    beepInterval = setInterval(() => {
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(800, audioCtx.currentTime); // Frekuensi 800Hz
        
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime); // Volume sedang
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.3);
    }, 800);
}

function stopBeep() {
    if (beepInterval) {
        clearInterval(beepInterval);
        beepInterval = null;
    }
}

async function setupCamera() {
    // Sesuaikan ukuran canvas dengan lebar layar
    const containerWidth = document.querySelector('.camera-container').offsetWidth;
    const size = Math.min(containerWidth, 400); 
    const flip = true; // Balikkan kamera (mirror) agar intuitif
    
    webcam = new tmImage.Webcam(size, size, flip); 
    
    try {
        await webcam.setup(); // Minta akses kamera
        await webcam.play();
        window.requestAnimationFrame(loop);

        canvas.width = size;
        canvas.height = size;
    } catch (error) {
        console.error("Gagal mengakses kamera:", error);
        alert("Akses kamera ditolak. Kamu harus mengizinkan kamera untuk mematikan alarm.");
    }
}

async function loop() {
    if (!isRinging) return; // Hentikan loop jika alarm sudah mati

    webcam.update(); // Update frame kamera
    await predict(); // Prediksi gambar
    window.requestAnimationFrame(loop); // Panggil loop berikutnya
}

async function predict() {
    if (!model || !webcam.canvas) return;

    // Lakukan prediksi menggunakan model AI
    const prediction = await model.predict(webcam.canvas);
    
    // Gambar video dari kamera ke canvas HTML
    const ctx = canvas.getContext('2d');
    ctx.drawImage(webcam.canvas, 0, 0);

    // Cari probabilitas untuk barang yang diminta (target)
    let targetConfidence = 0;
    for (let i = 0; i < maxPredictions; i++) {
        if (prediction[i].className === targetLabel) {
            targetConfidence = prediction[i].probability;
            break;
        }
    }

    // Perbarui Tampilan Status (Progress bar & persentase)
    const confidencePercent = Math.round(targetConfidence * 100);
    confidenceBar.style.width = `${confidencePercent}%`;
    confidenceText.textContent = `${confidencePercent}%`;

    // Ubah warna bar dan hitung jika confidence sesuai threshold
    if (targetConfidence >= REQUIRED_CONFIDENCE) {
        confidenceBar.style.backgroundColor = 'var(--success-color)';
        consecutiveHighConfidenceCount++;
    } else {
        confidenceBar.style.backgroundColor = 'var(--highlight)';
        // Reset counter jika barang tiba-tiba hilang dari kamera, tapi jangan langsung jadi 0 agar ada toleransi getaran
        consecutiveHighConfidenceCount = Math.max(0, consecutiveHighConfidenceCount - 1); 
    }

    // Cek Kondisi Berhenti: Jika barang terdeteksi konsisten selama N frame
    if (consecutiveHighConfidenceCount >= REQUIRED_FRAMES) {
        stopAlarm();
    }
}

// =======================================================
// ALARM BERHASIL DIMATIKAN
// =======================================================

function stopAlarm() {
    isRinging = false;
    stopBeep();
    
    if (webcam) {
        webcam.stop();
    }

    // Hapus alarm aktif agar tidak langsung berbunyi lagi
    alarmTime = null; 
    localStorage.removeItem('alarmTime');
    alarmTimeInput.value = '';
    updateAlarmUI();

    // Sembunyikan tantangan, tampilkan layar sukses
    challengeDiv.classList.add('hidden');
    successDiv.classList.remove('hidden');
}

btnReset.addEventListener('click', () => {
    // Kembali ke layar pengaturan
    successDiv.classList.add('hidden');
    settingsDiv.classList.remove('hidden');
});

// =======================================================
// JALANKAN APLIKASI
// =======================================================
initModel();
