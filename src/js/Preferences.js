const STORAGE_KEY = 'nanquim-preferences'

const DEFAULTS = {
    gridSize: 1,
    handlerSize: 16,
    defaultStrokeWidth: 0.1,
    hoverStrokeWidth: 0.4,
    hoverThreshold: 0.5,
}

function getPreferences() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) {
            const parsed = JSON.parse(stored)
            return { ...DEFAULTS, ...parsed }
        }
    } catch (e) {
        console.warn('Failed to read preferences from localStorage:', e)
    }
    return { ...DEFAULTS }
}

function savePreferences(prefs) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    } catch (e) {
        console.warn('Failed to save preferences to localStorage:', e)
    }
}

export { getPreferences, savePreferences, DEFAULTS }
