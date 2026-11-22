// Live equalizer for the listen screen.
// The 7 bars in #circler follow the real audio when levels are available:
//   - attachStream(stream): analyse a MediaStream the popup owns (microphone, tab capture)
//   - level messages from the content script (tab recording in the page)
// Until levels arrive, or if they stop, the bars fall back to the CSS animation.

const BARS = 7
const MIN_PX = 4, MAX_PX = 22
const STALE_MS = 900
// Music carries far less energy in the highs: lift the upper bands so every bar moves
const TILT = [1, 1, 1.15, 1.35, 1.7, 2.1, 2.6]

let bars = []
let eq = null
let current = new Array(BARS).fill(0)
let peaks = new Array(BARS).fill(0) // per-bar automatic gain (recent peak, slowly decaying)
let sources = new Map()        // source id -> { levels, at }
let analysers = []             // { ctx, analyser, bins }
let frame = null
let active = false

function init() {
    if (eq) return
    eq = document.getElementById("circler")
    bars = [...eq.querySelectorAll("span")]
    chrome.runtime?.onMessage?.addListener((msg, sender) => {
        if (!active || msg?.action !== "LibrezamLevels" || !Array.isArray(msg.levels)) return
        const key = `${sender?.tab?.id ?? ""}|${sender?.frameId ?? ""}|${msg.source ?? ""}`
        sources.set(key, { levels: msg.levels.slice(0, BARS).map(Number), at: performance.now() })
    })
}

// The visualizer is cosmetic: it must never break recognition, so errors are swallowed
export function startVisualizer() {
    try {
        init()
        stopVisualizer()
        active = true
        current.fill(0)
        peaks.fill(0)
        frame = requestAnimationFrame(render)
    } catch (e) {
        console.log("Visualizer unavailable", e)
    }
}

export function stopVisualizer() {
    try { stopVisualizerUnsafe() } catch (e) { console.log("Visualizer stop failed", e) }
}

function stopVisualizerUnsafe() {
    active = false
    if (frame) cancelAnimationFrame(frame)
    frame = null
    sources.clear()
    analysers.forEach(a => a.ctx.close().catch(() => {}))
    analysers = []
    if (eq) {
        eq.classList.remove("live")
        bars.forEach(b => (b.style.height = ""))
    }
}

export function attachStream(stream) {
    init()
    try {
        if (!stream?.getAudioTracks().length) return
        const ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0.6
        analyser.minDecibels = -85
        analyser.maxDecibels = -20
        ctx.createMediaStreamSource(stream).connect(analyser)
        analysers.push({ ctx, analyser, bins: new Uint8Array(analyser.frequencyBinCount) })
    } catch (e) {
        console.log("Visualizer: could not analyse stream", e)
    }
}

function bandLevels(bins, sampleRate, fftSize) {
    const edges = [60, 150, 350, 800, 1800, 3500, 6000, 10000]
    const hzPerBin = sampleRate / fftSize
    const out = []
    for (let b = 0; b < BARS; b++) {
        const from = Math.max(1, Math.floor(edges[b] / hzPerBin))
        const to = Math.max(from + 1, Math.ceil(edges[b + 1] / hzPerBin))
        let sum = 0
        for (let i = from; i < to && i < bins.length; i++) sum += bins[i]
        out.push(Math.min(1, sum / (to - from) / 255))
    }
    return out
}

function render() {
    try { renderFrame() } catch (e) { console.log("Visualizer frame failed", e); active = false }
}

function renderFrame() {
    if (!active) return
    const now = performance.now()
    const target = new Array(BARS).fill(0)
    let fresh = false

    for (const { ctx, analyser, bins } of analysers) {
        if (ctx.state === "closed") continue
        analyser.getByteFrequencyData(bins)
        bandLevels(bins, ctx.sampleRate, analyser.fftSize).forEach((v, i) => (target[i] = Math.max(target[i], v)))
        fresh = true
    }
    for (const [key, { levels, at }] of sources) {
        if (now - at > STALE_MS) { sources.delete(key); continue }
        levels.forEach((v, i) => (target[i] = Math.max(target[i], v || 0)))
        fresh = true
    }

    if (fresh) {
        eq.classList.add("live")
        for (let i = 0; i < BARS; i++) {
            // gentle curve so quiet music still moves; fast attack, slower release
            const raw = Math.min(1, target[i] * TILT[i])
            // auto-gain: scale each bar against its own recent peak (floor keeps silence flat)
            peaks[i] = Math.max(raw, peaks[i] * 0.992)
            const norm = raw / Math.max(peaks[i], 0.12)
            const t = Math.pow(0.4 * raw + 0.6 * norm, 0.85)
            current[i] += (t - current[i]) * (t > current[i] ? 0.55 : 0.18)
            bars[i].style.height = `${(MIN_PX + current[i] * (MAX_PX - MIN_PX)).toFixed(1)}px`
        }
    } else if (eq.classList.contains("live")) {
        // no levels any more (recording finished): back to the idle animation
        eq.classList.remove("live")
        bars.forEach(b => (b.style.height = ""))
        current.fill(0)
    }
    frame = requestAnimationFrame(render)
}
