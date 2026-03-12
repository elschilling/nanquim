import { getPreferences, savePreferences } from './Preferences'

function Preferences(editor) {
    const prefs = getPreferences()

    // Apply CSS variable for hover stroke width on init
    document.documentElement.style.setProperty('--hover-stroke-width', prefs.hoverStrokeWidth)

    // Create modal overlay
    const overlay = document.createElement('div')
    overlay.className = 'prefs-overlay'
    overlay.style.display = 'none'
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close()
    })

    // Create modal dialog
    const dialog = document.createElement('div')
    dialog.className = 'prefs-dialog'

    const title = document.createElement('h3')
    title.textContent = 'Preferences'
    title.className = 'prefs-title'
    dialog.appendChild(title)

    const fields = [
        { key: 'gridSize', label: 'Grid Size', step: 0.5, min: 0.1 },
        { key: 'handlerSize', label: 'Handler Size (px)', step: 1, min: 4 },
        { key: 'defaultStrokeWidth', label: 'Default Stroke Width', step: 0.01, min: 0.01 },
        { key: 'hoverStrokeWidth', label: 'Hover Stroke Width', step: 0.1, min: 0.1 },
        { key: 'hoverThreshold', label: 'Hover Threshold (px)', step: 1, min: 1 },
    ]

    const inputs = {}

    fields.forEach(({ key, label, step, min }) => {
        const row = document.createElement('div')
        row.className = 'prefs-row'

        const lbl = document.createElement('label')
        lbl.className = 'prefs-label'
        lbl.textContent = label

        const input = document.createElement('input')
        input.type = 'number'
        input.className = 'prefs-input'
        input.step = step
        input.min = min
        input.value = prefs[key]

        inputs[key] = input
        row.appendChild(lbl)
        row.appendChild(input)
        dialog.appendChild(row)
    })

    // Buttons row
    const btnRow = document.createElement('div')
    btnRow.className = 'prefs-buttons'

    const saveBtn = document.createElement('button')
    saveBtn.className = 'prefs-btn prefs-btn-save'
    saveBtn.textContent = 'Save'
    saveBtn.addEventListener('click', () => {
        const newPrefs = {}
        fields.forEach(({ key }) => {
            newPrefs[key] = parseFloat(inputs[key].value)
        })
        savePreferences(newPrefs)

        // Apply CSS variable immediately
        document.documentElement.style.setProperty('--hover-stroke-width', newPrefs.hoverStrokeWidth)

        // Notify all modules
        editor.signals.preferencesChanged.dispatch(newPrefs)

        close()
    })

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'prefs-btn prefs-btn-cancel'
    cancelBtn.textContent = 'Cancel'
    cancelBtn.addEventListener('click', close)

    btnRow.appendChild(cancelBtn)
    btnRow.appendChild(saveBtn)
    dialog.appendChild(btnRow)

    overlay.appendChild(dialog)
    document.body.appendChild(overlay)

    function open() {
        // Refresh input values from current storage
        const current = getPreferences()
        fields.forEach(({ key }) => {
            inputs[key].value = current[key]
        })
        overlay.style.display = 'flex'
    }

    function close() {
        overlay.style.display = 'none'
    }

    window.openPreferences = open
}

export { Preferences }
