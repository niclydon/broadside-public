/**
 * Thread body parsing. The ThreadComposer stores thread parts as a single
 * post body with the following shape:
 *
 *   [1/3]
 *   first part body
 *
 *   ---
 *
 *   [2/3]
 *   second part body
 *
 *   ---
 *
 *   [3/3]
 *   third part body
 *
 * These helpers round-trip between that format and a parts array.
 */

const SEPARATOR = '\n\n---\n\n';

/** Returns true if the body looks like it was produced by ThreadComposer. */
export function isThreadBody(body: string): boolean {
  return /\n---\n/.test(body) && /^\s*\[\d+\/\d+\]/.test(body);
}

/** Split a thread body back into the original parts, stripping [N/M] markers. */
export function parseThreadBody(body: string): string[] {
  return body
    .split(SEPARATOR)
    .map((part) => part.replace(/^\s*\[\d+\/\d+\]\s*\n?/, '').trim())
    .filter((p) => p.length > 0);
}
