export default function AppHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className={`page-header${compact ? ' page-header--compact' : ''}`}>
      <div className="brand">
        <span className="brand__mark" aria-hidden="true">
          Aa
        </span>
        <div className="brand__copy">
          <h1 className="page-header__title">English Typing Practice</h1>
          <div className="page-header__eyebrow">Read · Type · Learn</div>
        </div>
      </div>
    </header>
  );
}
