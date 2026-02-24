import { ReactNode } from 'react';

interface SettingsSectionProps {
  title: string;
  icon: string;
  children: ReactNode;
  className?: string;
}

export function SettingsSection({ title, icon, children, className = '' }: SettingsSectionProps) {
  return (
    <section className={`space-y-4 ${className}`}>
      <div className="flex items-center gap-2 text-primary-light">
        <span className="material-symbols-outlined text-sm">{icon}</span>
        <h3 className="text-[10px] font-black uppercase tracking-widest">{title}</h3>
      </div>
      <div className="space-y-4 pl-1">{children}</div>
    </section>
  );
}
