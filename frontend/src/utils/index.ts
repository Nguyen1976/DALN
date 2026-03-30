export const interceptorLoadingElements = (calling: unknown) => {
  // DOM lấy ra toàn bộ phần tử trên page hiện tại có className là 'interceptor-loading'
  const elements = document.querySelectorAll<HTMLElement>(
    '.interceptor-loading'
  )
  elements.forEach((el) => {
    if (calling) {
      el.style.opacity = '0.5'
      el.style.pointerEvents = 'none'
    } else {
      el.style.opacity = 'initial'
      el.style.pointerEvents = 'initial'
    }
  })
}

export function formatLastSeen(isoString?: string) {
  if (!isoString) return ""
  const diffMs = new Date().getTime() - new Date(isoString).getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffDays > 0) return `${diffDays} ngày trước`
  if (diffHours > 0) return `${diffHours} giờ trước`
  if (diffMinutes > 0) return `${diffMinutes} phút trước`
  return `${diffSeconds} giây trước`
}