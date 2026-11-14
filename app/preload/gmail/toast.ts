// The shadcn toast's shape resolved into plain values, in px because a rem inside a shadow root is measured against Gmail's root font size; the surface follows the app's popovers. The preload cannot load the interface's style sheet, which would put the whole of Tailwind's output into every Gmail page.
const TOAST_CSS = `
.toaster {
  --toast-surface: oklch(1 0 0);
  --toast-text: oklch(0.145 0 0);
  --toast-muted-text: oklch(0.556 0 0);
  --toast-hover-surface: oklch(0.97 0 0);
  --toast-ring: oklch(0.145 0 0 / 10%);
  --toast-button-surface: oklch(1 0 0);
  --toast-button-border: oklch(0.922 0 0);
  --toast-button-hover-surface: oklch(0.97 0 0);
}
@media (prefers-color-scheme: dark) {
  .toaster {
    --toast-surface: oklch(0.205 0 0);
    --toast-text: oklch(0.985 0 0);
    --toast-muted-text: oklch(0.708 0 0);
    --toast-hover-surface: oklch(0.269 0 0);
    --toast-ring: oklch(0.985 0 0 / 10%);
    --toast-button-surface: oklch(1 0 0 / 4.5%);
    --toast-button-border: oklch(1 0 0 / 15%);
    --toast-button-hover-surface: oklch(1 0 0 / 7.5%);
  }
}
*, *::before, *::after { box-sizing: border-box; }
.toaster {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  display: flex; width: 384px; max-width: calc(100vw - 32px); flex-direction: column; gap: 12px;
  color: var(--toast-text);
  font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
  font-size: 14px; line-height: 20px;
}
.toast {
  display: flex; align-items: center; gap: 12px; padding: 16px; border-radius: 10px;
  background: var(--toast-surface);
  box-shadow: 0 0 0 1px var(--toast-ring), 0 10px 15px -3px rgb(0 0 0 / 10%), 0 4px 6px -4px rgb(0 0 0 / 10%);
  opacity: 1; transition: opacity 200ms ease;
}
.toast-hidden { opacity: 0; }
.toast-title { min-width: 0; flex: 1; font-weight: 500; }
.toast-action {
  display: inline-flex; height: 28px; flex-shrink: 0; align-items: center; justify-content: center;
  padding: 0 10px; border: 1px solid var(--toast-button-border); border-radius: 8px;
  background: var(--toast-button-surface); background-clip: padding-box; color: inherit;
  font-family: inherit; font-size: 12.8px; font-weight: 500; white-space: nowrap; cursor: default;
  transition: background 200ms ease;
}
.toast-close {
  display: inline-flex; width: 28px; height: 28px; flex-shrink: 0; align-items: center; justify-content: center;
  padding: 0; border: none; border-radius: 8px; background: transparent; color: var(--toast-muted-text);
  cursor: default; transition: background 200ms ease, color 200ms ease;
}
.toast-action:hover { background: var(--toast-button-hover-surface); }
.toast-close:hover { background: var(--toast-hover-surface); color: var(--toast-text); }
.toast-action:active, .toast-close:active { transform: translateY(1px); }
@media (prefers-reduced-motion: reduce) { .toast, .toast-action, .toast-close { transition: none; } }`;

/** Matches the opacity transition in `TOAST_CSS`. */
const FADE_MS = 200;

const SVG = "http://www.w3.org/2000/svg";

export interface ToastOptions {
  readonly id: number;
  readonly title: string;
  readonly action: { readonly label: string; readonly run: () => void };
  /** The accessible names of the column and of a toast's close button. */
  readonly labels: { readonly toasts: string; readonly close: string };
}

export interface ToasterOptions {
  readonly document: Document;
  readonly later?: (delay: number, task: () => void) => void;
  readonly requestFrame?: (task: () => void) => void;
}

/** The toasts a page shows over Gmail, in a shadow root of their own so neither Gmail's styles nor ours reach the other; built on the first toast, so a page that never shows one builds nothing. */
export class Toaster {
  readonly #document: Document;
  readonly #later: (delay: number, task: () => void) => void;
  readonly #requestFrame: (task: () => void) => void;
  readonly #toasts = new Map<number, HTMLElement>();
  #host: HTMLElement | undefined;
  #column: HTMLElement | undefined;

  constructor(options: ToasterOptions) {
    this.#document = options.document;
    this.#later =
      options.later ??
      ((delay, task) => {
        setTimeout(task, delay);
      });
    this.#requestFrame =
      options.requestFrame ??
      ((task) => {
        requestAnimationFrame(() => {
          task();
        });
      });
  }

  show({ action, id, labels, title }: ToastOptions): void {
    // A toast of the same id is replaced without a fade, which would leave two copies in the column while it lasted.
    this.#toasts.get(id)?.remove();
    const document = this.#document;
    const toast = document.createElement("div");
    toast.className = "toast toast-hidden";
    toast.dataset.toastId = String(id);
    const text = document.createElement("div");
    text.className = "toast-title";
    text.textContent = title;
    const act = document.createElement("button");
    act.type = "button";
    act.className = "toast-action";
    act.textContent = action.label;
    act.addEventListener("click", () => {
      action.run();
      this.dismiss(id);
    });
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", labels.close);
    close.append(this.#closeIcon());
    close.addEventListener("click", () => {
      this.dismiss(id);
    });
    toast.append(text, act, close);
    this.#columnOf(labels.toasts).append(toast);
    this.#toasts.set(id, toast);
    // Captured, since Gmail stops some keys it handles itself from reaching the document.
    this.#document.addEventListener("keydown", this.#escape, true);
    // Two frames: one to lay the toast out at no opacity, one for the change to be a transition rather than where it starts.
    this.#requestFrame(() => {
      this.#requestFrame(() => {
        toast.classList.remove("toast-hidden");
      });
    });
  }

  dismiss(id: number): void {
    const toast = this.#toasts.get(id);
    if (toast === undefined) {
      return;
    }
    this.#toasts.delete(id);
    if (this.#toasts.size === 0) {
      this.#document.removeEventListener("keydown", this.#escape, true);
    }
    toast.classList.add("toast-hidden");
    // A timer rather than `transitionend`, which never fires while the pane is hidden and would leave the toast behind.
    this.#later(FADE_MS, () => {
      toast.remove();
    });
  }

  dispose(): void {
    this.#document.removeEventListener("keydown", this.#escape, true);
    this.#host?.remove();
    this.#host = undefined;
    this.#column = undefined;
    this.#toasts.clear();
  }

  /** Escape takes the newest toast down, and goes on to Gmail. */
  readonly #escape = (event: KeyboardEvent): void => {
    const newest = [...this.#toasts.keys()].at(-1);
    if (event.key === "Escape" && newest !== undefined) {
      this.dismiss(newest);
    }
  };

  #columnOf(label: string): HTMLElement {
    if (this.#column !== undefined) {
      return this.#column;
    }
    const document = this.#document;
    const host = document.createElement("div");
    host.id = "meru-toaster";
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = TOAST_CSS;
    const column = document.createElement("div");
    column.className = "toaster";
    // Off, so a new toast is announced alone rather than with every toast still showing.
    column.setAttribute("aria-atomic", "false");
    column.setAttribute("aria-label", label);
    column.setAttribute("aria-live", "polite");
    column.setAttribute("role", "status");
    root.append(style, column);
    document.body.append(host);
    this.#host = host;
    this.#column = column;
    return column;
  }

  // lucide's x at 16px.
  #closeIcon(): SVGElement {
    const icon = this.#document.createElementNS(SVG, "svg");
    for (const [name, value] of Object.entries({
      "aria-hidden": "true",
      fill: "none",
      height: "16",
      stroke: "currentColor",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "stroke-width": "2",
      viewBox: "0 0 24 24",
      width: "16",
    })) {
      icon.setAttribute(name, value);
    }
    for (const d of ["M18 6 6 18", "m6 6 12 12"]) {
      const path = this.#document.createElementNS(SVG, "path");
      path.setAttribute("d", d);
      icon.append(path);
    }
    return icon;
  }
}
