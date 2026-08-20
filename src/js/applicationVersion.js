const APPLICATION_VERSION = __NANQUIM_APP_VERSION__

function getApplicationLabel() {
  return `nanquim v${APPLICATION_VERSION}`
}

function applyApplicationVersion(documentRef = document) {
  const label = getApplicationLabel()

  documentRef.title = label
  documentRef.querySelectorAll('[data-application-version]').forEach((element) => {
    element.textContent = label
  })
}

export {
  APPLICATION_VERSION,
  applyApplicationVersion,
  getApplicationLabel,
}
