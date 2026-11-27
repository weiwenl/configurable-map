import './styles.css';
import Icon from './Icon';
import type { Ref } from 'react';

type LeftRailProps = {
  isAttributeDrawerOpen: boolean;
  onToggleAttributeDrawer: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
};

export default function LeftRail({ isAttributeDrawerOpen, onToggleAttributeDrawer, buttonRef }: LeftRailProps) {
  return (
    <nav className="left-rail" aria-label="Map settings">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Map settings"
        aria-pressed={isAttributeDrawerOpen}
        onClick={onToggleAttributeDrawer}
      >
        <Icon name="gear" />
        Settings
      </button>
    </nav>
  );
}
