import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import assets from "../../../lib/project-assets.json";
import { CheckoutButton } from "../../../components/checkout";

type ArchiveService = {
  sku: string;
  game: string;
  category: string;
  name: string;
  description: string;
  duration: string;
  price_minor: number;
  currency: string;
  inclusions?: string[];
  facts?: [string, string][];
};

const services = assets.services as unknown as ArchiveService[];
const find = (slug: string) => services.find((service) => service.sku === slug);

export function generateStaticParams() {
  return services.map((service) => ({ serviceSlug: service.sku }));
}

export async function generateMetadata({ params }: { params: Promise<{ serviceSlug: string }> }): Promise<Metadata> {
  const { serviceSlug } = await params;
  const service = find(serviceSlug);
  return { title: service ? `${service.name} — Ei point` : "Service — Ei point" };
}

// Service detail: archive facts plus the existing checkout action. No invented
// availability or promises — everything renders from the supplied archive.
export default async function ServiceDetailPage({ params }: { params: Promise<{ serviceSlug: string }> }) {
  const { serviceSlug } = await params;
  const service = find(serviceSlug);
  if (!service) notFound();
  const price = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: service.currency,
    maximumFractionDigits: 0,
  }).format(service.price_minor / 100);

  return (
    <section aria-label={service.name} className="ei-home-section">
      <p>
        <Link href="/services">← All services</Link>
      </p>
      <p>
        {service.game} · {service.category}
      </p>
      <h1>{service.name}</h1>
      <p className="lede">{service.description}</p>
      <div className="service-grid">
        <div className="clip-panel">
          <h2>What&rsquo;s included</h2>
          {service.inclusions?.length ? (
            <ul>
              {service.inclusions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>The archive lists no itemised inclusions for this service; the description above is the full scope.</p>
          )}
          {service.facts?.length ? (
            <dl>
              {service.facts.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        <div className="clip-panel">
          <h2>Price &amp; timing</h2>
          <p>
            <strong>{price}</strong>
          </p>
          <p>Estimated duration: {service.duration}</p>
          <p>Checkout always shows the authoritative amount for your order; staff confirm availability before starting.</p>
        </div>
      </div>
      <p>
        <CheckoutButton serviceId={service.sku} name={service.name} />
      </p>
      <p>
        <a className="ei-action" href="/verify">
          Verify an order ↗
        </a>{" "}
        <Link href="/help">Questions? Help centre ↗</Link>
      </p>
    </section>
  );
}
