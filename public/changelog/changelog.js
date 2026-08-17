/**
 * SnapDock - changelog / "What's New" page renderer.
 *
 * Version history lives in the CHANGELOG array below. To announce a release,
 * add a new entry at the TOP (newest first) and bump manifest.json to match.
 * The newest entry is rendered as the "Latest" (terracotta) node on the
 * timeline.
 *
 * Bullet text supports a tiny, safe inline syntax rendered as real DOM nodes
 * (never innerHTML): *italic* and [label](https://…). Anything else is literal.
 *
 * No inline scripts (extension pages enforce a strict CSP), no external code.
 */
"use strict";

/**
 * @typedef {Object} Change
 * @property {string} [lead]  Bold lead-in shown before the text, e.g. "Smart Alerts".
 * @property {string} text    Body copy; supports *italic* and [label](url).
 *
 * @typedef {Object} Release
 * @property {string} version   Semantic version, e.g. "1.1.0".
 * @property {string} date      ISO date (YYYY-MM-DD) of the release.
 * @property {string} [tag]     Timeline label, e.g. "Minor Release". Newest is "Latest".
 * @property {string} [summary] One-line headline shown under the version.
 * @property {Change[]} changes
 */

/** @type {Release[]} */
const CHANGELOG = [
  {
    version: "1.0.0",
    date: "2026-08-17",
    tag: "First Release",
    summary:
      "Capture. Configure. Save. High-quality screenshots and PDFs, saved where you want them.",
    changes: [
      {
        lead: "Three Ways to Capture",
        text: "Grab the visible area, drag a region, or capture an entire scrolling page. Long pages come out as one clean image, with sticky headers appearing once instead of repeating all the way down.",
      },
      {
        lead: "Save Anywhere",
        text: "Your device, Google Drive, or *both at once*. Saving to your device needs no account and works the moment you install it.",
      },
      {
        lead: "Real PDFs",
        text: "A4, A3, Letter, Legal, fit-to-image or a custom size, with orientation, margins and scale. A long page is split neatly across pages rather than squeezed onto one.",
      },
      {
        lead: "Sharp Images",
        text: "PNG, JPEG and WebP, with quality and resolution you choose. Defaults are lossless, so screenshots of text stay crisp.",
      },
      {
        lead: "Filenames You Control",
        text: "Build names from *{date}*, *{time}*, *{domain}*, *{title}* and more, with a live preview as you type.",
      },
      {
        lead: "One-Click Presets",
        text: "Save a whole setup, capture mode, format, PDF options, filename and destination, then run it later with a single click. Bug report and Documentation presets are included to start with.",
      },
      {
        lead: "Keyboard Shortcuts",
        text: "Capture the visible area, the full page, or a selected region without opening the popup at all.",
      },
      {
        lead: "Preview Before Saving",
        text: "Optionally check the image and its filename before it goes anywhere, and discard it if it is not what you wanted.",
      },
      {
        lead: "Never Lose a Capture",
        text: "If you save to two places and one of them fails, SnapDock tells you which copy exists and lets you retry just the one that did not.",
      },
      {
        lead: "Private by Design",
        text: "No analytics and no tracking. Your captures go straight to the destination you picked and nowhere else. See the [privacy policy](https://github.com/himanshuramavat/snap-dock/blob/main/PRIVACY.md).",
      },
    ],
  },
];



// Only http(s)/mailto links are turned into anchors; anything else stays text.
const ALLOWED_LINK = /^(https?:|mailto:)/i;
// Matches [label](url) or *italic* so we can build nodes instead of using HTML.
const INLINE_RE = /\[([^\]]+)\]\(([^)]+)\)|\*([^*]+)\*/g;

/** Appends `text` to `parent`, converting the tiny inline syntax to DOM nodes. */
const appendInline = (parent, text) => {
  let lastIndex = 0;
  let match;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    if (match[1] !== undefined) {
      const anchor = document.createElement("a");
      anchor.className = "change__link";
      anchor.textContent = match[1];
      if (ALLOWED_LINK.test(match[2].trim())) {
        anchor.href = match[2].trim();
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
      }
      parent.appendChild(anchor);
    } else if (match[3] !== undefined) {
      const em = document.createElement("em");
      em.textContent = match[3];
      parent.appendChild(em);
    }
    lastIndex = INLINE_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
};

const formatDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  // Build from parts so a bare YYYY-MM-DD isn't shifted by the local timezone.
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const buildEntry = (release, isLatest) => {
  const entry = document.createElement("article");
  entry.className = `entry ${isLatest ? "entry--latest" : "entry--minor"}`;

  const dot = document.createElement("span");
  dot.className = "entry__dot";
  dot.setAttribute("aria-hidden", "true");
  entry.appendChild(dot);

  const body = document.createElement("div");
  body.className = "entry__body";

  // --- Meta row: date • tag ---
  const meta = document.createElement("div");
  meta.className = "entry__meta";

  const date = document.createElement("time");
  date.className = "entry__date";
  date.dateTime = release.date;
  date.textContent = formatDate(release.date);
  meta.appendChild(date);

  const tagText = isLatest ? chrome.i18n.getMessage("latest") : release.tag;
  if (tagText) {
    const sep = document.createElement("span");
    sep.className = "entry__sep";
    sep.setAttribute("aria-hidden", "true");
    sep.textContent = "•";
    meta.appendChild(sep);

    const tag = document.createElement("span");
    tag.className = `entry__tag ${isLatest ? "entry__tag--latest" : ""}`;
    tag.textContent = tagText;
    meta.appendChild(tag);
  }
  body.appendChild(meta);

  // --- Card ---
  const card = document.createElement("div");
  card.className = "entry__card";

  const head = document.createElement("div");
  head.className = "entry__head";

  const version = document.createElement("h2");
  version.className = "entry__version";
  version.textContent = `${chrome.i18n.getMessage("versionLabel")} ${release.version}`;
  head.appendChild(version);

  if (isLatest) {
    const pill = document.createElement("span");
    pill.className = "entry__pill";
    pill.textContent = chrome.i18n.getMessage("latest");
    head.appendChild(pill);
  }
  card.appendChild(head);

  if (release.summary) {
    const summary = document.createElement("p");
    summary.className = "entry__summary";
    appendInline(summary, release.summary);
    card.appendChild(summary);
  }

  const list = document.createElement("ul");
  list.className = "changes";
  for (const change of release.changes) {
    const item = document.createElement("li");
    item.className = "change";
    if (change.lead) {
      const lead = document.createElement("strong");
      lead.className = "change__lead";
      lead.textContent = `${change.lead}: `;
      item.appendChild(lead);
    }
    appendInline(item, change.text);
    list.appendChild(item);
  }
  card.appendChild(list);

  body.appendChild(card);
  entry.appendChild(body);
  return entry;
};

// Sets each element's text to the matching chrome.i18n message, so the page
// renders in whichever UI language the browser is set to.
const localize = () => {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.title = chrome.i18n.getMessage("whatsNew");

  const textIds = {
    "page-heading": "whatsNew",
    "privacy-link": "privacyShort",
  };
  for (const [id, messageName] of Object.entries(textIds)) {
    const el = document.getElementById(id);
    if (el) el.textContent = chrome.i18n.getMessage(messageName);
  }

  const socialsNav = document.getElementById("socials-nav");
  if (socialsNav) {
    socialsNav.setAttribute("aria-label", chrome.i18n.getMessage("socialLinksAriaLabel"));
  }

  const websiteLink = document.getElementById("website-link");
  if (websiteLink) {
    websiteLink.setAttribute("aria-label", chrome.i18n.getMessage("websiteAriaLabel"));
  }

  const footerMeta = document.getElementById("footer-meta");
  if (footerMeta) {
    const year = String(new Date().getFullYear());
    footerMeta.textContent = chrome.i18n.getMessage("footerMeta", [year]);
  }
};

const render = () => {
  const params = new URLSearchParams(location.search);
  const isWelcome = params.get("welcome") === "1";

  localize();

  const subtitle = document.getElementById("page-subtitle");
  if (subtitle) {
    subtitle.textContent = chrome.i18n.getMessage(
      isWelcome ? "subtitleWelcome" : "subtitleDefault",
    );
  }

  const timeline = document.getElementById("timeline");
  if (timeline) {
    CHANGELOG.forEach((release, index) => {
      timeline.appendChild(buildEntry(release, index === 0));
    });
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", render, { once: true });
} else {
  render();
}
