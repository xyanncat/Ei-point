"use client";
// Commerce · Services: the archive catalog with original INR prices.
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { Empty, PageHeader, Panel } from "../../../../components/staff/ui";

type CatalogItem = { sku: string; name: string; priceMinor: number; currency: string };

export default function CommerceServicesPage() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api<{ items: CatalogItem[] }>("/api/catalog")
      .then((r) => setCatalog(r.items))
      .catch(() => setCatalog([]))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Commerce"
        title="Services"
        explain="Archive definitions with their original INR prices. Staff confirm availability before payment."
      />
      <Panel title="Service catalog" detail="Read-only definitions from the supplied archive.">
        {catalog.length ? (
          <table className="sf-table">
            <thead>
              <tr><th>SKU</th><th>Service</th><th>Price</th></tr>
            </thead>
            <tbody>
              {catalog.map((item) => (
                <tr key={item.sku}>
                  <td className="sf-num">{item.sku}</td>
                  <td>{item.name}</td>
                  <td>{(item.priceMinor / 100).toFixed(2)} {item.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty
            title={loaded ? "Catalog unavailable" : "Loading catalog…"}
            detail={loaded ? "The catalog endpoint did not return definitions." : undefined}
          />
        )}
      </Panel>
    </>
  );
}
