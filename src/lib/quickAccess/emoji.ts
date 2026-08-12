export interface EmojiEntry {
  char: string;
  /** Search terms, lowercase. The first one doubles as the label. */
  keywords: string[];
}

export interface EmojiGroup {
  name: string;
  entries: EmojiEntry[];
}

const e = (char: string, ...keywords: string[]): EmojiEntry => ({ char, keywords });

/**
 * A curated palette rather than the full Unicode set.
 *
 * Shipping ~3,800 emoji with a keyword index would be a data file larger than
 * this whole feature, to solve a problem this feature does not have: the job is
 * telling one project tile apart from the next, and past a couple of hundred
 * choices a picker stops helping. Anything outside the palette still gets in —
 * paste it into the search field and it is offered directly (see
 * `looksLikeEmoji`), so the curation narrows browsing, never expression.
 */
export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    name: 'Work',
    entries: [
      e('🚀', 'rocket', 'launch', 'ship', 'start'),
      e('💡', 'bulb', 'idea', 'light'),
      e('🔥', 'fire', 'hot', 'urgent'),
      e('⚡', 'zap', 'bolt', 'fast', 'power'),
      e('✨', 'sparkles', 'new', 'magic'),
      e('🎯', 'target', 'goal', 'aim', 'focus'),
      e('📈', 'chart', 'growth', 'up', 'metrics'),
      e('📊', 'bar chart', 'stats', 'data', 'analytics'),
      e('🧭', 'compass', 'direction', 'navigate'),
      e('🗺️', 'map', 'plan', 'route'),
      e('📌', 'pin', 'pinned', 'important'),
      e('📎', 'clip', 'attach'),
      e('🗂️', 'files', 'folders', 'archive'),
      e('📁', 'folder', 'directory'),
      e('📝', 'memo', 'note', 'write', 'draft'),
      e('📄', 'page', 'document', 'doc'),
      e('📚', 'books', 'docs', 'library', 'reference'),
      e('🏷️', 'label', 'tag'),
      e('💼', 'briefcase', 'business', 'work'),
      e('🧾', 'receipt', 'invoice', 'billing'),
      e('📅', 'calendar', 'date', 'schedule'),
      e('⏱️', 'timer', 'stopwatch', 'time', 'perf'),
      e('✅', 'check', 'done', 'complete'),
      e('🚧', 'construction', 'wip', 'progress'),
    ],
  },
  {
    name: 'Tech',
    entries: [
      e('💻', 'laptop', 'computer', 'code', 'dev'),
      e('🖥️', 'desktop', 'monitor', 'screen'),
      e('⌨️', 'keyboard', 'typing', 'input'),
      e('🖱️', 'mouse', 'pointer', 'click'),
      e('🧑‍💻', 'developer', 'coder', 'programmer'),
      e('🤖', 'robot', 'bot', 'agent', 'ai'),
      e('🧠', 'brain', 'ai', 'think', 'ml'),
      e('⚙️', 'gear', 'settings', 'config', 'engine'),
      e('🔧', 'wrench', 'tool', 'fix', 'maintenance'),
      e('🔨', 'hammer', 'build', 'make'),
      e('🛠️', 'tools', 'toolkit', 'build'),
      e('🧰', 'toolbox', 'kit', 'utils'),
      e('🐛', 'bug', 'defect', 'issue'),
      e('🧪', 'test', 'lab', 'experiment', 'beta'),
      e('🔬', 'microscope', 'research', 'inspect'),
      e('🗄️', 'database', 'storage', 'cabinet'),
      e('💾', 'disk', 'save', 'floppy', 'storage'),
      e('📦', 'package', 'box', 'bundle', 'release'),
      e('🔌', 'plug', 'plugin', 'connect', 'integration'),
      e('🔗', 'link', 'chain', 'url'),
      e('📡', 'satellite', 'signal', 'api', 'network'),
      e('🛰️', 'satellite', 'orbit', 'remote'),
      e('☁️', 'cloud', 'hosting', 'infra'),
      e('🕸️', 'web', 'network', 'graph'),
      e('🔍', 'search', 'find', 'magnify', 'lookup'),
      e('🧩', 'puzzle', 'piece', 'module', 'extension'),
      e('🔐', 'lock', 'secure', 'auth', 'security'),
      e('🔑', 'key', 'secret', 'token', 'credentials'),
      e('🛡️', 'shield', 'protect', 'security', 'defense'),
      e('🧱', 'brick', 'wall', 'foundation', 'infra'),
    ],
  },
  {
    name: 'Media',
    entries: [
      e('🎨', 'art', 'design', 'palette', 'paint'),
      e('🖌️', 'brush', 'paint', 'design'),
      e('🖼️', 'picture', 'image', 'frame', 'gallery'),
      e('📷', 'camera', 'photo', 'shot'),
      e('🎬', 'clapper', 'film', 'video', 'movie'),
      e('🎥', 'camera', 'video', 'record'),
      e('🎙️', 'mic', 'podcast', 'audio', 'record'),
      e('🎧', 'headphones', 'audio', 'listen', 'music'),
      e('🎵', 'music', 'note', 'sound'),
      e('📺', 'tv', 'screen', 'broadcast'),
      e('📱', 'phone', 'mobile', 'app'),
      e('✏️', 'pencil', 'edit', 'write'),
      e('🖊️', 'pen', 'write', 'sign'),
      e('📰', 'news', 'article', 'blog', 'press'),
      e('🗞️', 'newspaper', 'blog', 'post'),
      e('📢', 'megaphone', 'announce', 'marketing'),
      e('💬', 'speech', 'chat', 'comment', 'message'),
      e('✉️', 'mail', 'email', 'letter'),
    ],
  },
  {
    name: 'Nature',
    entries: [
      e('🌱', 'seedling', 'grow', 'new', 'start'),
      e('🌿', 'herb', 'plant', 'green'),
      e('🌳', 'tree', 'forest', 'nature'),
      e('🍀', 'clover', 'luck', 'four leaf'),
      e('🌸', 'blossom', 'flower', 'spring'),
      e('🌵', 'cactus', 'desert', 'plant'),
      e('🌊', 'wave', 'water', 'ocean', 'flow'),
      e('🌙', 'moon', 'night', 'dark'),
      e('☀️', 'sun', 'day', 'light'),
      e('⭐', 'star', 'favorite', 'featured'),
      e('🌟', 'glow star', 'shine', 'highlight'),
      e('🌈', 'rainbow', 'color', 'pride'),
      e('❄️', 'snow', 'cold', 'freeze', 'winter'),
      e('🍂', 'leaves', 'autumn', 'fall'),
      e('🔮', 'crystal ball', 'predict', 'future', 'magic'),
      e('🌍', 'earth', 'world', 'global'),
    ],
  },
  {
    name: 'Animals',
    entries: [
      e('🐙', 'octopus', 'many arms', 'parallel'),
      e('🦊', 'fox', 'clever'),
      e('🐝', 'bee', 'busy', 'swarm'),
      e('🦋', 'butterfly', 'change', 'transform'),
      e('🐢', 'turtle', 'slow', 'steady'),
      e('🦉', 'owl', 'wise', 'night'),
      e('🐳', 'whale', 'big', 'docker'),
      e('🦈', 'shark', 'fast', 'hunt'),
      e('🐧', 'penguin', 'linux'),
      e('🐴', 'horse', 'fast'),
      e('🦄', 'unicorn', 'rare', 'special'),
      e('🐉', 'dragon', 'power', 'legend'),
      e('🐜', 'ant', 'small', 'worker'),
      e('🕷️', 'spider', 'crawler', 'scrape'),
    ],
  },
  {
    name: 'Food',
    entries: [
      e('☕', 'coffee', 'cafe', 'morning'),
      e('🍵', 'tea', 'calm', 'brew'),
      e('🍕', 'pizza', 'food', 'slice'),
      e('🍔', 'burger', 'food'),
      e('🍜', 'noodles', 'ramen', 'food'),
      e('🍎', 'apple', 'fruit'),
      e('🍋', 'lemon', 'fruit', 'sour'),
      e('🍓', 'strawberry', 'fruit', 'berry'),
      e('🥑', 'avocado', 'fruit', 'green'),
      e('🌶️', 'chili', 'spicy', 'hot'),
      e('🍰', 'cake', 'sweet', 'celebrate'),
      e('🍪', 'cookie', 'sweet', 'session'),
      e('🍫', 'chocolate', 'sweet'),
      e('🥂', 'cheers', 'celebrate', 'launch'),
    ],
  },
  {
    name: 'Places',
    entries: [
      e('🏠', 'house', 'home', 'local'),
      e('🏢', 'office', 'building', 'company'),
      e('🏭', 'factory', 'industry', 'pipeline'),
      e('🏛️', 'classic building', 'institution', 'bank', 'legal'),
      e('🏰', 'castle', 'fortress', 'legacy'),
      e('⛺', 'tent', 'camp', 'temporary'),
      e('🗼', 'tower', 'landmark'),
      e('🌉', 'bridge', 'connect', 'migration'),
      e('🚗', 'car', 'drive', 'travel'),
      e('✈️', 'plane', 'flight', 'travel', 'deploy'),
      e('🚂', 'train', 'rail', 'pipeline'),
      e('⛵', 'boat', 'sail', 'ship'),
      e('🛸', 'ufo', 'alien', 'experimental'),
      e('🧳', 'luggage', 'travel', 'pack'),
    ],
  },
  {
    name: 'Symbols',
    entries: [
      e('❤️', 'heart', 'love', 'favorite'),
      e('🧡', 'orange heart', 'love'),
      e('💛', 'yellow heart', 'love'),
      e('💚', 'green heart', 'love'),
      e('💙', 'blue heart', 'love'),
      e('💜', 'purple heart', 'love'),
      e('🖤', 'black heart', 'love', 'dark'),
      e('🔴', 'red circle', 'dot', 'stop'),
      e('🟠', 'orange circle', 'dot'),
      e('🟡', 'yellow circle', 'dot'),
      e('🟢', 'green circle', 'dot', 'go'),
      e('🔵', 'blue circle', 'dot'),
      e('🟣', 'purple circle', 'dot'),
      e('⚫', 'black circle', 'dot'),
      e('🔶', 'orange diamond', 'shape'),
      e('🔷', 'blue diamond', 'shape'),
      e('♦️', 'diamond', 'shape'),
      e('⬛', 'black square', 'shape'),
      e('🔺', 'red triangle', 'up', 'shape'),
      e('♾️', 'infinity', 'endless', 'loop'),
      e('⚠️', 'warning', 'caution', 'alert'),
      e('🚨', 'siren', 'alert', 'incident', 'urgent'),
      e('🏁', 'finish', 'flag', 'done', 'race'),
      e('🎉', 'party', 'celebrate', 'release'),
      e('🏆', 'trophy', 'win', 'award'),
      e('🥇', 'gold medal', 'first', 'win'),
      e('👑', 'crown', 'king', 'premium', 'main'),
      e('💎', 'gem', 'diamond', 'premium', 'valuable'),
      e('🧿', 'amulet', 'protection', 'charm'),
      e('♻️', 'recycle', 'refactor', 'reuse'),
    ],
  },
];

/** Flat view, used for search and for the "all" listing. */
export const ALL_EMOJI: EmojiEntry[] = EMOJI_GROUPS.flatMap((group) => group.entries);

/**
 * True when the text is (or starts with) a pictographic character — the escape
 * hatch that lets any emoji in, palette or not.
 */
export function looksLikeEmoji(text: string): boolean {
  return /\p{Extended_Pictographic}/u.test(text.trim());
}

/** Substring match over every keyword, plus the character itself. */
export function searchEmoji(query: string): EmojiEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return ALL_EMOJI;
  return ALL_EMOJI.filter(
    (entry) =>
      entry.char === query.trim() || entry.keywords.some((keyword) => keyword.includes(needle))
  );
}

/** The first keyword doubles as the accessible name. */
export function emojiLabel(entry: EmojiEntry): string {
  return entry.keywords[0] ?? entry.char;
}
