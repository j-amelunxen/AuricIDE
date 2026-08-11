import { ReactNode } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

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
        <AuricIcon name={icon} className="text-sm" />
        <h3 className="text-[10px] font-black uppercase tracking-widest">{title}</h3>
      </div>
      <div className="space-y-4 pl-1">{children}</div>
    </section>
  );
}
