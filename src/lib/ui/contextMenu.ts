export type ContextMenuOption =
  | { type: 'separator' }
  | { type: 'header'; label: string }
  | {
      type?: 'item';
      label: string;
      icon?: string;
      iconColor?: string;
      /** A custom mark in place of the icon glyph — e.g. a project tile.
       *  Wrapped decorative (aria-hidden), same as the icon it replaces. */
      leading?: React.ReactNode;
      action?: () => void;
      danger?: boolean;
      /** Skip the auto-close after this item's action — for an item that
       *  leads to a further stage (e.g. a project that opens an epic
       *  sub-menu) rather than finishing the interaction. Defaults to false:
       *  every existing call site keeps closing on click. */
      keepOpen?: boolean;
      /** The item cannot run now. It stays in the menu with this sentence under
       *  its label, so the reason is readable without hovering. */
      disabledReason?: string;
      /** Makes the item one choice of a group: a `menuitemradio` that says whether it is the chosen one. */
      checked?: boolean;
    };
