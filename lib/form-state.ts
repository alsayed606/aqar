/**
 * What a form action reports back to the screen that called it.
 *
 * `field` is the whole point: it names the input the message belongs under. Without it every message
 * has to live at the top of the page, which is where the office stopped reading them — a rejected
 * e-mail change was announced above a long settings page while the reader worked at its foot.
 *
 * Actions return this instead of redirecting. A redirect reloads the page and discards what the user
 * typed, so the reader who finally notices the warning has nothing left to correct.
 */
export type FormState = {
  /** What went wrong, in the office's words. */
  error?: string;
  /** The `name` of the input it belongs under. Absent means the form as a whole. */
  field?: string;
  /** What went right — shown as a toast, because it needs no action. */
  ok?: string;
};
