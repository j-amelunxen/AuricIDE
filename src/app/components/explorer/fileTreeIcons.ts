export const gitBadgeMap = {
  added: { label: 'A', className: 'text-git-added' },
  modified: { label: 'M', className: 'text-git-modified' },
  deleted: { label: 'D', className: 'text-git-deleted' },
} as const;

export function getFileIcon(name: string): { icon: string; color?: string } {
  const ext = name.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'md':
    case 'markdown':
      return { icon: 'article', color: 'text-primary-light' };
    case 'ts':
    case 'tsx':
      return { icon: 'javascript', color: 'text-blue-400' };
    case 'js':
    case 'jsx':
      return { icon: 'javascript', color: 'text-yellow-400' };
    case 'rs':
      return { icon: 'settings_b_roll', color: 'text-orange-500' };
    case 'py':
      return { icon: 'terminal', color: 'text-blue-500' };
    case 'json':
      return { icon: 'data_object', color: 'text-yellow-600' };
    case 'html':
      return { icon: 'html', color: 'text-orange-600' };
    case 'css':
      return { icon: 'css', color: 'text-blue-600' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'bmp':
    case 'ico':
    case 'avif':
      return { icon: 'image', color: 'text-green-400' };
    case 'mp4':
    case 'webm':
    case 'mov':
    case 'm4v':
    case 'ogv':
      return { icon: 'video_file', color: 'text-purple-400' };
    case 'zip':
    case 'tar':
    case 'gz':
      return { icon: 'folder_zip', color: 'text-foreground-muted' };
    case 'workflow': // Custom extension
      return { icon: 'account_tree', color: 'text-primary' };
    default:
      if (name.startsWith('.')) return { icon: 'settings', color: 'text-foreground-muted' };
      return { icon: 'description' };
  }
}
