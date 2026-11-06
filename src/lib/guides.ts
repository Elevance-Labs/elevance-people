import type { BusinessFunction } from './types'

// The guides on the Resources page live in the guides table, one per doc and
// business function; the database shows each employee only their own
// function's (company admins all). A guide's link is a Google Doc, Sheet or
// Slides; one without a link yet is listed as coming soon.

export const GUIDE_COLUMNS = 'id, slug, title, description, business_function, doc_url, sort_order'

export const FUNCTION_SUMMARIES: Record<BusinessFunction, string> = {
  production: 'Building and shipping the product: how we plan, design, build, test and deliver.',
  growth: 'Bringing in and keeping customers: how we sell, market and grow.',
  operations: 'Running the company: how we look after our people and our money.',
}

/**
 * Where to open a guide's doc, and the address to frame. A Doc, Sheet or
 * Slides shared by link is framed through `/edit`: Google lets other sites
 * frame its editor, and that is the view where someone with commenter (or
 * editor) access can comment; a viewer just reads. That needs the viewer
 * signed into Google with access to the doc. A Doc published to the web
 * frames through `?embedded=true`, read-only, with no sign-in. Anything else
 * is framed as it is.
 */
export function guideUrls(doc: string): { open: string; embed: string } {
  const published = /^(https:\/\/docs\.google\.com\/document\/d\/e\/[\w-]+\/pub)(?:[?#]|$)/.exec(doc)
  if (published) return { open: published[1], embed: `${published[1]}?embedded=true` }
  // Not /d/e/…: that is a published Sheet or Slides, which frames as it is.
  const shared = SHARED_DOC.exec(doc)
  if (shared) return { open: doc, embed: `${shared[1]}/edit` }
  return { open: doc, embed: doc }
}

const SHARED_DOC = /^(https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/(?!e\/)[\w-]+)/

// What the guide form accepts: a Google Docs, Sheets or Slides link, shared
// or published. The database only insists on docs.google.com.
export const isGoogleDocUrl = (url: string) =>
  /^https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[\w-]+/.test(url)

// A published link can't take comments; the form says so.
export const isPublishedDocUrl = (url: string) => /^https:\/\/docs\.google\.com\/[a-z]+\/d\/e\//.test(url)

// A new guide's address, from its title, unique among those taken (a company
// admin reads every guide). Kept when the guide is renamed.
export function guideSlug(title: string, taken: string[]): string {
  const base =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'guide'
  let slug = base
  for (let n = 2; taken.includes(slug); n++) slug = `${base}-${n}`
  return slug
}

export function guideError(error: { code?: string; message: string }) {
  if (error.code === '23505') return 'Another guide already has this address. Try a different title.'
  if (error.code === '23514') return 'Enter a Google Docs, Sheets or Slides link.'
  if (error.code === '42501') return 'Only a company admin can manage guides.'
  return error.message
}
