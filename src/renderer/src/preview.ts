/** This copy of the app is shown inside Settings → Device preview. */
export const PREVIEW = new URLSearchParams(location.search).has('preview')

if (PREVIEW) document.documentElement.classList.add('device-preview')
