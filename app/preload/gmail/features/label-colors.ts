import { cssString } from "../../../core/css.ts";
import type { LabelColor } from "../../../core/records/label-color.ts";
import { cssOf } from "../../content/styles.ts";
import type { StyleRule } from "../../content/styles.ts";
import type { GmailFeature } from "../feature.ts";

const textColorOf = (label: LabelColor): string => {
  if (label.textColor === "white") {
    return "#ffffff";
  }
  if (label.textColor === "black") {
    return "#000000";
  }
  return `contrast-color(${label.color})`;
};

// Gmail draws a label in three places, each coloured by its name: the chip in a thread row (`.at`, whose text sits in descendants), the row in the label menu of an open conversation (`.ahR`), and the chip on a card in the new conversation view (`.aim`), whose own text is already white on Gmail's colour.
const rulesFor = (label: LabelColor): StyleRule[] => {
  const name = cssString(label.label);
  const text = textColorOf(label);
  const background = `background-color: ${label.color} !important;`;
  return [
    { declarations: background, selector: `.at[title=${name}]` },
    {
      declarations: `color: ${text} !important;`,
      selector: `.at[title=${name}] *`,
    },
    {
      declarations: `${background} color: ${text} !important;`,
      selector: `.ahR .hN[data-name=${name}], .ahR .hO[data-name=${name}]`,
    },
    {
      declarations: background,
      selector: `.aim:has([data-tooltip=${name}]) .aEe`,
    },
  ];
};

export const labelColorRules = (labels: readonly LabelColor[]): StyleRule[] =>
  labels.flatMap(rulesFor);

export const labelColors: GmailFeature = {
  apply: ({ settings, style }) => {
    style(cssOf(labelColorRules(settings.labelColors)));
  },
  id: "labelColors",
};
