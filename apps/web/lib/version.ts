// FB5 (R40/P32, docs/feedback-v1-ux.md §FB5): the release version shown in
// the header badge derives from package.json — the SINGLE source of truth
// for the web app's version. There is deliberately no second version
// constant anywhere: bumping package.json's "version" is the only way to
// change what renders. This partially supersedes the R36/C4 no-version
// ruling: REAL release versions are now ALLOWED in the header; invented or
// pseudo-OS version chrome (the prototype's V10.5) remains BANNED (F5/§63).
import pkg from '../package.json'

export const RELEASE_VERSION: string = pkg.version
