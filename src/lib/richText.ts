import DOMPurify from 'dompurify'

// What the editor (components/RichText.tsx) can produce. Anything else is
// dropped, so pasted or stored HTML can't carry scripts, styles or images.
const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a']
const ALLOWED_ATTR = ['href', 'target', 'rel']

// Links always open in a new tab without access to this page.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer nofollow')
  }
})

// Run on save and again wherever HTML is shown: the description reaches
// people who aren't signed in, so never trust what's stored.
export function sanitizeHtml(html: string) {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR })
}

export function isBlankHtml(html: string | null | undefined) {
  return !html || !html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
}

// Shared by the editor and the read-only view, so a description looks the
// same while it's written as on the public page.
export const richTextSx = {
  typography: 'body1',
  lineHeight: 1.7,
  overflowWrap: 'anywhere',
  '& > :first-of-type': { mt: 0 },
  '& > :last-child': { mb: 0 },
  '& p': { my: 1.25 },
  '& h2': { typography: 'h6', mt: 3, mb: 1 },
  '& h3': { typography: 'subtitle1', fontWeight: 600, mt: 2.5, mb: 0.75 },
  '& ul, & ol': { pl: 3, my: 1.25 },
  '& li > p': { my: 0.25 },
  '& blockquote': { borderLeft: 3, borderColor: 'divider', pl: 2, ml: 0, color: 'text.secondary' },
  '& a': { color: 'primary.main' },
}
