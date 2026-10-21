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
 * Where to open a guide's doc, and the address Google lets other sites frame:
 * `?embedded=true` for a Doc published to the web, `/preview` for a Doc, Sheet
 * or Slides shared by link. Anything else is framed as it is.
 */
export function guideUrls(doc: string): { open: string; embed: string } {
  const published = /^(https:\/\/docs\.google\.com\/document\/d\/e\/[\w-]+\/pub)(?:[?#]|$)/.exec(doc)
  if (published) return { open: published[1], embed: `${published[1]}?embedded=true` }
  // Not /d/e/…: that is a published Sheet or Slides, which frames as it is.
  const shared = /^(https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/(?!e\/)[\w-]+)/.exec(doc)
  if (shared) return { open: doc, embed: `${shared[1]}/preview` }
  return { open: doc, embed: doc }
}
