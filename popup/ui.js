// Librezam UI helpers
// Replaces native browser widgets with themed ones:
//   <select>          -> custom dropdown (the native select stays as the source of truth)
//   title="..."       -> custom tooltip
//   input[type=range] -> themed slider with a filled track
//   alert / confirm   -> uiAlert / uiConfirm (themed dialogs, promise-based)

import { t } from "./i18n.js"

const onReady = fn => document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", fn, { once: true })
    : fn()

onReady(() => {
    enhanceAll(document)
    initTooltips()
    preventImageDrag()

    // Pages build parts of their UI in JS: enhance new controls as they appear
    new MutationObserver(records => {
        for (const r of records) {
            r.addedNodes.forEach(node => node.nodeType === 1 && enhanceAll(node))
        }
    }).observe(document.body, { childList: true, subtree: true })
})

function enhanceAll(root) {
    const pick = sel => [...(root.matches?.(sel) ? [root] : []), ...root.querySelectorAll(sel)]
    pick("select").forEach(enhanceSelect)
    pick('input[type="range"]').forEach(enhanceRange)
}

// ---------- Dropdowns ----------

const nativeValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")
const nativeIndex = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex")
let openMenu = null

function enhanceSelect(select) {
    if (select.dataset.uiEnhanced || select.multiple) return
    select.dataset.uiEnhanced = "1"

    const wrap = document.createElement("div")
    wrap.className = "ui-select"
    select.parentNode.insertBefore(wrap, select)
    wrap.appendChild(select)
    select.classList.add("ui-native")
    select.tabIndex = -1
    select.setAttribute("aria-hidden", "true")

    const button = document.createElement("button")
    button.type = "button"
    button.className = "ui-select-button"
    button.setAttribute("aria-haspopup", "listbox")
    button.setAttribute("aria-expanded", "false")
    if (select.id) {
        const label = document.querySelector(`label[for="${select.id}"]`)
        if (label) {
            label.htmlFor = ""
            label.addEventListener("click", () => button.focus())
            if (!label.id) label.id = `${select.id}-label`
            button.setAttribute("aria-labelledby", label.id)
        }
    }
    button.innerHTML = `<span class="ui-select-label"></span><i class="material-icons ui-select-chevron">expand_more</i>`
    wrap.appendChild(button)

    const menu = document.createElement("ul")
    menu.className = "ui-select-menu"
    menu.setAttribute("role", "listbox")
    wrap.appendChild(menu)

    const label = button.querySelector(".ui-select-label")
    const refresh = () => {
        label.textContent = select.selectedOptions[0]?.textContent.trim() ?? ""
        button.disabled = select.disabled
    }

    // Keep the label in sync when page code sets .value / .selectedIndex
    Object.defineProperty(select, "value", {
        configurable: true,
        get() { return nativeValue.get.call(this) },
        set(v) { nativeValue.set.call(this, v); refresh() },
    })
    Object.defineProperty(select, "selectedIndex", {
        configurable: true,
        get() { return nativeIndex.get.call(this) },
        set(v) { nativeIndex.set.call(this, v); refresh() },
    })
    // ...and when options get translated or replaced
    new MutationObserver(refresh).observe(select, { childList: true, subtree: true, characterData: true, attributes: true })
    select.addEventListener("change", refresh)
    refresh()

    let active = -1
    const items = () => [...menu.children]
    const setActive = i => {
        const list = items()
        if (!list.length) return
        active = (i + list.length) % list.length
        list.forEach((li, n) => li.classList.toggle("active", n === active))
        list[active].scrollIntoView({ block: "nearest" })
    }

    const choose = index => {
        const option = select.options[index]
        if (!option || option.disabled) return
        if (nativeIndex.get.call(select) !== index) {
            nativeIndex.set.call(select, index)
            select.dispatchEvent(new Event("input", { bubbles: true }))
            select.dispatchEvent(new Event("change", { bubbles: true }))
        }
        refresh()
        close()
        button.focus()
    }

    const open = () => {
        if (openMenu) openMenu()
        menu.innerHTML = ""
        ;[...select.options].forEach((opt, i) => {
            const li = document.createElement("li")
            li.setAttribute("role", "option")
            li.textContent = opt.textContent.trim()
            if (opt.disabled) li.classList.add("disabled")
            if (i === nativeIndex.get.call(select)) {
                li.classList.add("selected")
                li.setAttribute("aria-selected", "true")
            }
            li.addEventListener("click", () => choose(i))
            li.addEventListener("pointermove", () => setActive(i))
            menu.appendChild(li)
        })
        // Open upwards when there isn't room below
        wrap.classList.remove("up")
        wrap.classList.add("open")
        const rect = menu.getBoundingClientRect()
        if (rect.bottom > window.innerHeight - 6 && button.getBoundingClientRect().top > rect.height + 6) {
            wrap.classList.add("up")
        }
        button.setAttribute("aria-expanded", "true")
        setActive(Math.max(0, nativeIndex.get.call(select)))
        openMenu = close
    }

    function close() {
        wrap.classList.remove("open", "up")
        button.setAttribute("aria-expanded", "false")
        if (openMenu === close) openMenu = null
    }

    button.addEventListener("click", e => {
        e.stopPropagation()
        wrap.classList.contains("open") ? close() : open()
    })
    button.addEventListener("keydown", e => {
        const isOpen = wrap.classList.contains("open")
        if (["ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault()
            if (!isOpen) return open()
            setActive(active + (e.key === "ArrowDown" ? 1 : -1))
        } else if (e.key === "Home" && isOpen) { e.preventDefault(); setActive(0) }
        else if (e.key === "End" && isOpen) { e.preventDefault(); setActive(-1) }
        else if ((e.key === "Enter" || e.key === " ") && isOpen) { e.preventDefault(); choose(active) }
        else if (e.key === "Escape" && isOpen) { e.preventDefault(); close() }
        else if (e.key === "Tab" && isOpen) close()
    })
    document.addEventListener("click", e => { if (!wrap.contains(e.target)) close() })
}

// ---------- Sliders ----------

function enhanceRange(input) {
    if (input.dataset.uiEnhanced) return
    input.dataset.uiEnhanced = "1"
    input.classList.add("ui-range")
    const update = () => {
        const min = Number(input.min || 0), max = Number(input.max || 100)
        const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0
        input.style.setProperty("--pct", `${pct}%`)
    }
    input.addEventListener("input", update)
    input.addEventListener("change", update)
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
    Object.defineProperty(input, "value", {
        configurable: true,
        get() { return proto.get.call(this) },
        set(v) { proto.set.call(this, v); update() },
    })
    update()
}

// ---------- Tooltips ----------

function initTooltips() {
    const tip = document.createElement("div")
    tip.className = "ui-tooltip"
    tip.setAttribute("role", "tooltip")
    document.body.appendChild(tip)

    let target = null
    let timer = null

    const hide = () => {
        clearTimeout(timer)
        tip.classList.remove("show")
        target = null
    }

    // Move title -> data-tooltip so the browser never shows its own box
    const adopt = el => {
        const text = el.getAttribute("title")
        el.removeAttribute("title")
        if (text) {
            el.dataset.tooltip = text
            if (!el.getAttribute("aria-label") && !el.textContent.trim()) el.setAttribute("aria-label", text)
        }
    }
    document.querySelectorAll("[title]").forEach(adopt)
    new MutationObserver(records => {
        for (const r of records) {
            if (r.type === "attributes" && r.target.hasAttribute("title")) adopt(r.target)
            r.addedNodes?.forEach(n => {
                if (n.nodeType !== 1) return
                if (n.hasAttribute("title")) adopt(n)
                n.querySelectorAll("[title]").forEach(adopt)
            })
        }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] })

    const show = () => {
        if (!target?.isConnected || !target.dataset.tooltip) return hide()
        tip.textContent = target.dataset.tooltip
        tip.classList.remove("below")
        tip.style.left = "0px"
        tip.style.top = "0px"
        const r = target.getBoundingClientRect()
        const w = tip.offsetWidth, h = tip.offsetHeight
        let top = r.top - h - 8
        if (top < 4) { top = r.bottom + 8; tip.classList.add("below") }
        const left = Math.min(Math.max(4, r.left + r.width / 2 - w / 2), window.innerWidth - w - 4)
        tip.style.left = `${left}px`
        tip.style.top = `${top}px`
        tip.classList.add("show")
    }

    document.addEventListener("pointerover", e => {
        const el = e.target.closest?.("[data-tooltip], [title]")
        if (el?.hasAttribute("title")) adopt(el)
        if (el === target) return
        hide()
        if (!el || !el.dataset.tooltip) return
        target = el
        timer = setTimeout(show, 450)
    })
    document.addEventListener("pointerout", e => {
        if (target && !target.contains(e.relatedTarget)) hide()
    })
    document.addEventListener("pointerdown", hide)
    document.addEventListener("scroll", hide, true)
    document.addEventListener("keydown", hide)
}

// ---------- Misc ----------

// Stop the browser's "ghost image" when dragging pictures (except in drag-to-reorder lists)
function preventImageDrag() {
    document.addEventListener("dragstart", e => {
        if (e.target.tagName === "IMG" && !e.target.parentElement?.closest('[draggable="true"]')) e.preventDefault()
    })
}

// ---------- Dialogs ----------

function dialog({ title, message, buttons }) {
    return new Promise(resolve => {
        const previous = document.activeElement
        const overlay = document.createElement("div")
        overlay.className = "ui-dialog-overlay"
        const box = document.createElement("div")
        box.className = "ui-dialog"
        box.setAttribute("role", "alertdialog")
        box.setAttribute("aria-modal", "true")
        if (title) {
            const h = document.createElement("h3")
            h.className = "ui-dialog-title"
            h.textContent = title
            box.appendChild(h)
        }
        const msg = document.createElement("p")
        msg.className = "ui-dialog-message"
        msg.textContent = message
        const actions = document.createElement("div")
        actions.className = "ui-dialog-actions"
        box.append(msg, actions)
        overlay.appendChild(box)

        const finish = value => {
            overlay.classList.remove("show")
            document.removeEventListener("keydown", onKey, true)
            setTimeout(() => overlay.remove(), 150)
            previous?.focus?.()
            resolve(value)
        }
        const onKey = e => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(buttons.find(b => b.cancel)?.value ?? false) }
        }

        let primary = null
        buttons.forEach(b => {
            const btn = document.createElement("button")
            btn.type = "button"
            btn.className = `ui-dialog-btn${b.primary ? " primary" : ""}${b.danger ? " danger" : ""}`
            btn.textContent = b.label
            btn.addEventListener("click", () => finish(b.value))
            actions.appendChild(btn)
            if (b.primary) primary = btn
        })
        overlay.addEventListener("click", e => {
            if (e.target === overlay) finish(buttons.find(b => b.cancel)?.value ?? false)
        })

        document.body.appendChild(overlay)
        document.addEventListener("keydown", onKey, true)
        requestAnimationFrame(() => overlay.classList.add("show"))
        ;(primary || actions.lastElementChild)?.focus()
    })
}

const label = (key, fallback) => {
    const text = t(key)
    return text && text !== key ? text : fallback
}

export function uiAlert(message, title = "") {
    return dialog({ title, message, buttons: [{ label: "OK", value: true, primary: true, cancel: true }] })
}

export function uiConfirm(message, { title = label("confirm", "Confirm"), danger = false } = {}) {
    return dialog({
        title,
        message,
        buttons: [
            { label: label("no", "No"), value: false, cancel: true },
            { label: label("yes", "Yes"), value: true, primary: true, danger },
        ],
    })
}
