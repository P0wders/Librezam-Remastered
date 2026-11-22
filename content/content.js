// When a message is received on clicking an icon, the audio in the DOM element is retrieved and responds to the pop-up script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if(request.action == "Record") {
        mainRecorder(request.times, request.levels)
        sendResponse(true)
    }
    if(request.action == "QueryAutoMode") {
        sendResponse(window.isAutoMode)
    }
    if(request.action == "SetAutoMode") {
        window.isAutoMode = Boolean(request.checked)
        sendResponse(window.isAutoMode)
    }
    if(request.action == "GetNextRecorded") {
        getNextRecorded().then(r => sendResponse(r))
    }
    return true
})
let audioPromisesMap = []


function mainRecorder(times, sendLevels) {
    let elements = findMediaElements()
    if(sendLevels && elements.length) {
        elements.forEach((elem, i) => streamLevels(elem, i, Math.max(...times)))
    }
    audioPromisesMap = times.map(time => 
        elements.map(elem => 
            recordElem(elem, time)
        )
    )
}

// Live audio levels for the popup's equalizer bars.
// Sends 7 band levels (0..1) about 20 times per second while recording;
// only these numbers leave the page, never the audio itself.
function streamLevels(elem, index, durationMs) {
    if(checkIfCORS(elem)) return // recorded by the background page, no live stream here
    let ctx
    try {
        const stream = createStream(elem)
        if(!stream.getAudioTracks().length) return
        ctx = new AudioContext()
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0.6
        analyser.minDecibels = -85
        analyser.maxDecibels = -20
        const mute = ctx.createGain()
        mute.gain.value = 0
        source.connect(analyser)
        analyser.connect(mute)
        mute.connect(ctx.destination) // keeps the graph running, silently
        const bins = new Uint8Array(analyser.frequencyBinCount)
        const source_id = `${location.href}#${index}`
        const timer = setInterval(() => {
            analyser.getByteFrequencyData(bins)
            const sent = chrome.runtime.sendMessage({
                action: "LibrezamLevels",
                source: source_id,
                levels: bandLevels(bins, ctx.sampleRate, analyser.fftSize),
            })
            sent?.catch?.(() => {}) // popup closed: nobody listening
        }, 50)
        setTimeout(() => {
            clearInterval(timer)
            ctx.close().catch(() => {})
        }, durationMs + 100)
    } catch(e) {
        ctx?.close().catch(() => {})
    }
}

// 7 log-spaced bands from ~60 Hz to ~10 kHz, averaged and scaled to 0..1
function bandLevels(bins, sampleRate, fftSize) {
    const edges = [60, 150, 350, 800, 1800, 3500, 6000, 10000]
    const hzPerBin = sampleRate / fftSize
    const levels = []
    for(let b = 0; b < 7; b++) {
        const from = Math.max(1, Math.floor(edges[b] / hzPerBin))
        const to = Math.max(from + 1, Math.ceil(edges[b + 1] / hzPerBin))
        let sum = 0
        for(let i = from; i < to && i < bins.length; i++) sum += bins[i]
        levels.push(Math.min(1, sum / (to - from) / 255))
    }
    return levels
}

function getNextRecorded() {
    if (audioPromisesMap.length === 0) {
        return Promise.resolve(-1);
    }
    const promises = audioPromisesMap.shift();
    return Promise.allSettled(promises).then(results =>
        results.map(result => Array.from(result.value))
    );
}

function checkIfCORS(elem) {
    if(!elem.currentSrc) return false
    if(elem.classList.contains("librezamCORS")) return true
    if(new URL(elem.currentSrc).origin != document.location.origin) return true
}

// Ensure Shadow-root is explored recursively (Fix for some websites such as reddit)
// https://stackoverflow.com/a/75787966/27020071
function findMediaElements() {
    const elements = Array.from(document.querySelectorAll('audio, video'))
    for (const {shadowRoot} of document.querySelectorAll("*")) {
        if (shadowRoot) {
            elements.push(...shadowRoot.querySelectorAll("audio, video"));
        }
    }
    return elements.filter(media => !media.paused);
}

function createStream(elem){
    let mediaStream
    if(!elem.mediaStream?.active) {
        let stream = elem.captureStream ? elem.captureStream() : elem.mozCaptureStream()
        mediaStream = new MediaStream(stream.getAudioTracks())
        elem.mediaStream = mediaStream
    } else {
        mediaStream = elem.mediaStream
    }

    if (!elem.classList.contains("librezamFlag") && !elem.captureStream){
        let audioCtx = new AudioContext()
        let source = audioCtx.createMediaElementSource(elem)
        source.connect(audioCtx.destination)
        elem.classList.add("librezamFlag")
    }
    return mediaStream
}

function recordElem(elem, ms){
    if(checkIfCORS(elem)) {
        return recordElemCORS(elem.currentSrc, elem.currentTime, ms)
    }
    let stream = createStream(elem)
    return new Promise(resolve => {
        let data = []
        let recorder = new MediaRecorder(stream)
        recorder.ondataavailable = e => data.push(e.data)
        recorder.onstop = _ => data[0].arrayBuffer().then(ab => resolve(new Uint8Array(ab)))
        recorder.start()
        setTimeout(() => recorder.stop(), ms)
    })
}

function recordElemCORS(mediaSrc, currentTime, ms){
    if(mediaSrc.includes("v16-webapp-prime.tiktok.com")){
        mediaSrc = mediaSrc.replace("v16-webapp-prime.tiktok.com", "v19-webapp-prime.tiktok.com")
    }
    return chrome.runtime.sendMessage({
        action:"CORSRecord",
        mediaSrc,
        currentTime,
        ms
    })
}