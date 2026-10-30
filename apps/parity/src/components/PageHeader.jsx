import { Children } from "react";
import HelpButton from "./HelpButton";
// One heading and action layout across the workspace. Kept outside printed documents.
export default function PageHeader({ title, subtitle, meta, children }) {
  const slots = Children.toArray(children);
  const help = slots.filter((child) => child.type === HelpButton);
  const actions = slots.filter((child) => child.type !== HelpButton);
  return (
    <header className="page-header workspace-heading">
      <div className="workspace-heading-copy">
        <div className="workspace-heading-title">
          <h1 className="page-title">{title}</h1>
          {help}
          {meta && <span className="workspace-heading-meta">{meta}</span>}
        </div>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions.length > 0 && (
        <div className="workspace-heading-actions">{actions}</div>
      )}
    </header>
  );
}
