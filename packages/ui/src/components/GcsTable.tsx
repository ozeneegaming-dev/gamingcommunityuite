import type { ReactNode } from "react";
import { cx } from "../cx";

export type GcsTableColumn<T> = {
  key: keyof T & string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
};

export type GcsTableProps<T> = {
  columns: GcsTableColumn<T>[];
  rows: T[];
  /** Textul afișat când nu există rânduri. */
  empty: string;
  /** Cheia React a unui rând; implicit, indexul. */
  rowKey?: (row: T, index: number) => string | number;
  caption?: string;
  className?: string;
};

export function GcsTable<T>({ columns, rows, empty, rowKey, caption, className }: GcsTableProps<T>) {
  return (
    <div className={cx("gcs-table", className)}>
      <table className="gcs-table__table">
        {caption && <caption className="gcs-srOnly">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx("gcs-table__th", c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="gcs-table__empty" colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={rowKey ? rowKey(row, i) : i} className="gcs-table__row">
                {columns.map((c) => (
                  <td key={c.key} className={cx("gcs-table__td", c.className)}>
                    {c.render ? c.render(row) : String(row[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
