import { Recognize } from "/backendModules/Recognize.js"
import { getStorage, setStorage } from "../common/storageHelper.js"
import { t } from "./i18n.js"
import { STREAMING_PROVIDERS } from "../common/streamingProviders.js"

let isBusy = false

init()

function init() {
    if(window.location.search.includes("mic=true")) {
        startMicRecognition()
    } else {
        startTabRecognition()
    }

    menuController()
    listenController()
    writeHistory()
    autoModeController()
    micRecognitionController()
}

// UI state: "idle" | "listening" | "result" | "error"
function setState(state) {
    document.body.dataset.state = state
}

function menuController() {
    const button = document.getElementById("menuButton")
    const menu = document.getElementById("dropdownMenu")
    const close = () => {
        menu.classList.remove("open")
        button.setAttribute("aria-expanded", "false")
    }
    button.addEventListener("click", e => {
        e.stopPropagation()
        const open = menu.classList.toggle("open")
        button.setAttribute("aria-expanded", String(open))
    })
    document.addEventListener("click", e => {
        if (!menu.contains(e.target) || e.target.closest("a")) close()
    })
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") close()
    })
}

function listenController() {
    document.getElementById("listenButton").addEventListener("click", () => {
        if (!isBusy) startTabRecognition()
    })
    document.getElementById("listenAgain").addEventListener("click", () => {
        if (!isBusy) startTabRecognition()
    })
    document.getElementById("micButton").addEventListener("click", () => {
        if (!isBusy) startMicRecognition()
    })
}

async function startTabRecognition() {
    isBusy = true
    try {
        await runTabRecognition()
    } finally {
        isBusy = false
    }
}

async function runTabRecognition() {
    getTabId.tabId = null
    showStatus(t("listening"))

    let fallbackRules = await getStorage("fallbackRules")
    let times = Object.keys(fallbackRules).map(t => Number(t))
    let backendsMap = Object.values(fallbackRules)

    const captureMethod = await getStorage("captureMethod")
    let tabCaptureAudios = null

    if (captureMethod === "tabCapture" && typeof chrome !== 'undefined' && chrome.tabCapture) {
        try {
            tabCaptureAudios = await recordFromTabCapture(times)
        } catch(e) {
            console.error("Tab capture failed:", e)
            // If error is about tab not playing audio, show noAudioElementsDetected
            if (e.message && e.message.includes("not playing audio")) {
                showError(t("noAudioElementsDetected"))
            } else {
                showError(t("songNotRecognized"))
            }
            return
        }
    } else {
        await recordAudiosInTab(times)
    }

        for(let backends of backendsMap) {
            showStatus(t("listening"))
            let audios
            
            if (tabCaptureAudios) {
                try {
                    let audio = await tabCaptureAudios.shift()
                    audios = audio ? [audio] : []
                } catch(e) {
                    audios = []
                }
            } else {
                audios = await getNextRecorded().then(r => r.filter(a=> a.length))
            }
            
            if(!audios.length) {
                showError(t("noAudioElementsDetected"))
                return
            }

            for(let backend of backends) {
                let isFound = await getResult(audios, backend)
                if(isFound) {
                    return
                }
            }
        }
        showError(t("songNotRecognized"))
}

async function recordFromTabCapture(times) {
    return new Promise((resolve, reject) => {
        // Check if tab is audible before capturing
        chrome.tabs.query({active: true, currentWindow: true}, async (tabs) => {
            const tab = tabs[0]
            
            // Check if tab is audible - if not, reject immediately
            if (!tab || !tab.audible) {
                return reject(new Error("Tab is not playing audio"))
            }
            
            chrome.tabCapture.capture({ audio: true, video: false }, async (stream) => {
                
                if (chrome.runtime.lastError || !stream) {
                    return reject(chrome.runtime.lastError || new Error("Stream capture failed"))
                }
                
                // To prevent muting the tab, play the audio through a new AudioContext
                const audioContext = new AudioContext()
                const source = audioContext.createMediaStreamSource(stream)
                source.connect(audioContext.destination)

                const recorder = new MediaRecorder(stream)
                const data = []

                recorder.ondataavailable = e => {
                    data.push(e.data)
                }
                recorder.start(10)

                const maxTime = Math.max(...times)
                setTimeout(() => {
                    recorder.stop()
                    stream.getTracks().forEach(track => track.stop())
                    audioContext.close()
                }, maxTime)

                let audioPromises = []
                for (let time of times) {
                    let audioPromise = new Promise(resolveData => {
                        setTimeout(() => {
                            const blob = new Blob(data, { type: 'audio/webm' })
                            blob.arrayBuffer().then(buffer => {
                                const uint8Array = new Uint8Array(buffer)
                                resolveData(uint8Array)
                            })
                        }, time)
                    })
                    audioPromises.push(audioPromise)
                }
                resolve(audioPromises)
            })
        })
    })
}

async function getResult(audios, backend) {
    for(let audio of audios) {
        try{
            showStatus(t("queryingWith", [backend]))
            let result = await Recognize(audio, backend)
            await writeResult(result)
            await saveHistory(result)
            await writeHistory() // Update history display immediately
            return true
        } catch(e) {
            console.log(e)
        }
    }
    return false
}

let currentHistories = []
let currentSort = { field: 'date', ascending: false } // Default: date descending

async function writeHistory(){
    currentHistories = await getStorage("histories") || []
    // Sort by date descending by default
    currentHistories.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    renderHistoryTable()
    setupHistoryControls()
}

function renderHistoryTable(histories = currentHistories) {
    const container = document.getElementById("historyCards")
    container.innerHTML = ""
    const escapeStr = t => new Option(t).innerHTML

    if (!histories.length) {
        container.innerHTML = `<div class="history-empty">—</div>`
        return
    }

    histories.forEach((history, index) => {
        const card = document.createElement("div")
        card.className = "history-card detail-btn"
        card.dataset.index = index
        card.title = [history.title, history.artist, history.album].filter(Boolean).join(" · ")

        const dateStr = history.timestamp ? new Date(history.timestamp).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : ""

        card.innerHTML = `
            <img class="history-card-cover" loading="lazy" alt="" ${history.art ? `src="${escapeStr(history.art)}"` : ""}>
            <div class="history-card-main-info">
                <div class="history-card-title">${escapeStr(history.title)}</div>
                <div class="history-card-artist">${escapeStr(history.artist)}</div>
            </div>
            ${dateStr ? `<div class="history-card-date">${escapeStr(dateStr)}</div>` : ''}
            <button class="iconButton delete-btn" data-index="${index}">
                <i class="material-icons">delete_outline</i>
            </button>
        `

        container.appendChild(card)
    })
}

function setupHistoryControls() {
    // Remove existing event listeners to prevent duplicates
    const sortButtons = ['sortByTitle', 'sortByArtist', 'sortByDate']
    sortButtons.forEach(id => {
        const button = document.getElementById(id)
        const newButton = button.cloneNode(true)
        button.parentNode.replaceChild(newButton, button)
    })

    // Sort controls
    document.getElementById("sortByTitle").addEventListener("click", () => {
        toggleSort('title')
    })
    
    document.getElementById("sortByArtist").addEventListener("click", () => {
        toggleSort('artist')
    })
    
    document.getElementById("sortByDate").addEventListener("click", () => {
        toggleSort('date')
    })

    // Detail and delete buttons - use event delegation to avoid duplicates
    if (!document.hasHistoryControlsListener) {
        document.addEventListener("click", async (e) => {
            if (e.target.closest(".delete-btn")) {
                e.stopPropagation()
                const index = parseInt(e.target.closest(".delete-btn").dataset.index)
                await deleteHistoryItem(index)
            } else if (e.target.closest(".detail-btn")) {
                if (isBusy) return
                const index = parseInt(e.target.closest(".detail-btn").dataset.index)
                await writeResult(currentHistories[index])
                document.getElementById("surfaceContainer").scrollIntoView({ behavior: "smooth" })
            }
        })
        document.hasHistoryControlsListener = true
    }
}

function toggleSort(field) {
    // If clicking the same field, toggle ascending/descending
    if (currentSort.field === field) {
        currentSort.ascending = !currentSort.ascending
    } else {
        // If clicking a different field, start with ascending
        currentSort.field = field
        currentSort.ascending = true
    }
    
    // Sort the histories
    currentHistories.sort((a, b) => {
        let comparison = 0
        
        switch (field) {
            case 'title':
                comparison = a.title.localeCompare(b.title)
                break
            case 'artist':
                comparison = a.artist.localeCompare(b.artist)
                break
            case 'date':
                comparison = (a.timestamp || 0) - (b.timestamp || 0)
                break
        }
        
        return currentSort.ascending ? comparison : -comparison
    })
    
    // Update sort indicators
    updateSortIndicators()
    
    // Re-render table
    renderHistoryTable()
}

function updateSortIndicators() {
    // Reset all icons to unfold_more
    document.querySelectorAll('.sort-icon').forEach(icon => {
        icon.textContent = 'unfold_more'
    })
    document.querySelectorAll('#historyControls .chip').forEach(chip => chip.classList.remove('active'))

    // Set the active sort icon
    const activeButton = document.getElementById(`sortBy${currentSort.field.charAt(0).toUpperCase() + currentSort.field.slice(1)}`)
    activeButton.classList.add('active')
    const activeIcon = activeButton.querySelector('.sort-icon')
    
    if (currentSort.ascending) {
        activeIcon.textContent = 'keyboard_arrow_up'
    } else {
        activeIcon.textContent = 'keyboard_arrow_down'
    }
}

async function deleteHistoryItem(index) {
    currentHistories.splice(index, 1)
    await setStorage("histories", currentHistories)
    renderHistoryTable()
}

async function recordAudiosInTab(times){
    return await sendMessagePromises({action: "Record", times: times})
}

async function getNextRecorded() {
    let responses = await sendMessagePromises({action: "GetNextRecorded"})
    return [].concat(...responses).map(arr => new Uint8Array(arr))
}

async function getTabId() {
    if(getTabId.tabId) {
        return getTabId.tabId
    }
    let tab = await chrome.tabs.query({active:true, currentWindow:true}).then(t => t[0])
    let tabId = tab.id
    let isRecordAnotherTab = await getStorage("isRecordAnotherTab")
    if(!tab.audible && isRecordAnotherTab){
        let anotherTab = await chrome.tabs.query({audible:true, currentWindow:true}).then(t => t[0])
        if(anotherTab){
            tabId = anotherTab.id
        }
    }
    getTabId.tabId = tabId
    return tabId
}

async function sendMessagePromises(request) {
    let promises = []
    let tabId = await getTabId()

    let frames = await chrome.webNavigation.getAllFrames({tabId:tabId})
    frames.forEach(f => {
        let promise = chrome.tabs.sendMessage(tabId, request, {frameId:f.frameId})
        promises.push(promise)
    })
    return Promise.allSettled(promises).then(arr => arr.map(r => r.value))
}

async function writeResult(result){
    // Cover art + blurred backdrop
    const cover = document.getElementById("coverArt")
    if (result.art) {
        cover.src = result.art
        surfaceContainer.style.setProperty("--art", `url("${result.art.replace(/["\\\n]/g, encodeURIComponent)}")`)
    } else {
        cover.removeAttribute("src")
        surfaceContainer.style.removeProperty("--art")
    }

    // Update basic info
    let elms = ["title", "artist", "album"]
    elms.forEach(out => {
        let outElm = document.querySelector(`.result.${out}`)
        outElm.innerText = result[out] || ""
    })

    // Update streaming providers
    await updateStreamingProviders(result)
    setState("result")
}

async function updateStreamingProviders(result) {
    const selectedProviders = await getStorage("selectedStreamingProviders")
    
    // Provider icons mapping
    // Clear existing providers
    streamProviders.innerHTML = ''
    
    // Add selected providers
    selectedProviders.forEach(providerId => {
        if (result[providerId]) {
            const providerElement = document.createElement('a')
            providerElement.className = `result stream ${providerId}`
            providerElement.href = result[providerId]
            providerElement.target = '_blank'
            
            const img = document.createElement('img')
            img.src = STREAMING_PROVIDERS[providerId]?.icon
            img.className = 'circle responsive-img'
            img.title = `Search on ${STREAMING_PROVIDERS[providerId]?.name}`
            
            providerElement.appendChild(img)
            streamProviders.appendChild(providerElement)
        }
    })
}

async function saveHistory(result){
    let newItem = {
        ...result,
        timestamp: Date.now() // Add timestamp for sorting
    }

    let histories = await getStorage("histories")
    // Remove duplicates based on title and artist
    histories = histories.filter(item => !(item.title === newItem.title && item.artist === newItem.artist))
    histories.push(newItem)

    await setStorage("histories", histories)
}

function showError(msg) {
    notification.textContent = msg
    const hint = document.createElement("span")
    hint.className = "hint"
    hint.textContent = t("tapToRetry")
    notification.appendChild(hint)
    setState("error")
}

function showStatus(msg) {
    if (!msg) {
        notification.textContent = ""
        return
    }
    // Animate trailing dots ("Listening...")
    const baseMessage = msg.replace(/(\.+|…)$/, '')
    const hasDots = baseMessage !== msg
    notification.textContent = baseMessage
    if (hasDots) {
        const dots = document.createElement("span")
        dots.className = "dots"
        dots.innerHTML = '<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>'
        notification.appendChild(dots)
    }
    setState("listening")
}

async function autoModeController() {
    isAutoMode.checked = await sendMessagePromises({action: "QueryAutoMode"}).then(r => Boolean(r?.[0]))
    isAutoMode.addEventListener("change", async evt => {
        await sendMessagePromises({action: "SetAutoMode", checked: evt.target.checked})
    })
}

async function micRecognitionController() {
    document.getElementById("micRecognition").addEventListener("click", async (e) => {
        e.preventDefault()
        if (!isBusy) await startMicRecognition()
    })
}

async function startMicRecognition() {
    if (isBusy) return
    isBusy = true
    try {
        showStatus(t("listening"))

        // Get fallback rules
        let fallbackRules = await getStorage("fallbackRules")
        let times = Object.keys(fallbackRules).map(t => Number(t))
        let backendsMap = Object.values(fallbackRules)
        
        // Record from microphone
        let micAudios = await recordFromMicrophone(times)
        
        // Try recognition with fallback
        for(let backends of backendsMap) {
            showStatus(t("listening"))
            let audio = await micAudios.shift()
            if(!audio) {
                showError(t("noAudioRecordedFromMicrophone"))
                return
            }

            for(let backend of backends) {
                let isFound = await getResult([audio], backend)
                if(isFound) {
                    return
                }
            }
        }
        showError(t("songNotRecognizedFromMicrophone"))
    } catch(e) {
        console.error("Microphone recognition error:", e)
        showError(t("failedToAccessMicrophone"))
    } finally {
        isBusy = false
    }
}

async function recordFromMicrophone(times) {
    try {
        if(await navigator.permissions.query({ name: 'microphone' }).then(r => r.state !== "granted")) {
            window.open("/popup/grantMicrophone.html", "_blank")
            throw new Error("Microphone access denied")
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const recorder = new MediaRecorder(stream)
        const data = []

        recorder.ondataavailable = e => data.push(e.data)
        recorder.start(10)

        setTimeout(() => recorder.stop(), Math.max(...times))
        let audioPromises = []
        for(let time of times) {
            let audioPromise = new Promise(resolve => setTimeout(_ => new Blob([new Blob([])].concat(data)).arrayBuffer().then(r => resolve(new Uint8Array(r))), time))
            audioPromises.push(audioPromise)
        }
        return audioPromises
    } catch(error) {
        throw new Error(`Microphone access failed: ${error.message}`)
    }
}
