import { useEffect, useState } from "react";
import { parseChangelog } from "../utils/changelog";
export default function ReleaseNotes() {
  const [entries, setEntries] = useState(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/changelog")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        if (active) setEntries(parseChangelog(data.text, 3));
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section aria-labelledby="release-title">
      <h2 id="release-title">What's new</h2>
      {failed ? (
        <p>Release notes could not be loaded. See the repository changelog.</p>
      ) : entries === null ? (
        <p>Loading release notes…</p>
      ) : (
        entries.map((entry) => (
          <details key={entry.version} open>
            <summary>
              KNOWGST {entry.version} · {entry.date}
            </summary>
            {entry.sections.map((section) => (
              <div key={section.title}>
                <h3>{section.title}</h3>
                <ul>
                  {section.blocks.map((block, i) => (
                    <li key={i}>
                      {block.text}
                      {block.children?.length > 0 && (
                        <ul>
                          {block.children.map((text, j) => (
                            <li key={j}>{text}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
        ))
      )}
    </section>
  );
}
