export default function AppHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className={`page-header${compact ? ' page-header--compact' : ''}`}>
      <h1 className="page-header__title">English Typing Practice</h1>
      <div className="page-header__eyebrow">Read · Type · Learn</div>
    </header>
  );
}
