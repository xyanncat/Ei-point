import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import assets from "../../../lib/project-assets.json";
import { CheckoutButton } from "../../../components/checkout";
import { Reveal } from "../../../components/motion";

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
    <section className="world-section world-shell" aria-label={service.name}>
      <p>
        <Link href="/services">← All services</Link>
      </p>
      <div className="world-page">
        <Reveal>
          <p className="world-eyebrow">
            {service.game} · {service.category}
          </p>
          <h1 className="world-title">{service.name}</h1>
          <p className="world-lede">{service.description}</p>
        </Reveal>

          <Reveal delay={0.08}>
            <div className="glass world-card" style={{ marginTop: "1.4rem" }}>
              <span className="world-card__tag">Price and timing</span>
              <p className="world-card__price" style={{ fontSize: "1.8rem" }}>
                {price}
              </p>
              <p className="world-note">
                Estimated duration: {service.duration}. Checkout always shows
                the authoritative amount for your order, and staff confirm
                availability before any work starts.
              </p>
            </div>
          </Reveal>

          {service.inclusions?.length ? (
            <Reveal delay={0.12}>
              <div className="prose" style={{ marginTop: "1.8rem" }}>
                <h2>What is included</h2>
                <ul>
                  {service.inclusions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ) : (
            <Reveal delay={0.12}>
              <div className="prose" style={{ marginTop: "1.8rem" }}>
                <h2>Scope</h2>
                <p>
                  The archive lists no itemised inclusions for this service.
                  The description above is the full scope.
                </p>
              </div>
            </Reveal>
          )}

          {service.facts?.length ? (
            <Reveal delay={0.16}>
              <div className="prose" style={{ marginTop: "1.4rem" }}>
                <h2>Details</h2>
                <dl>
                  {service.facts.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Reveal>
          ) : null}

          <Reveal delay={0.2}>
            <div style={{ marginTop: "1.8rem" }}>
              <CheckoutButton serviceId={service.sku} name={service.name} />
            </div>
            <p className="world-note">
              <Link href="/verify">Verify an order ↗</Link> ·{" "}
              <Link href="/docs">Questions? Read the docs ↗</Link>
            </p>
          </Reveal>
      </div>
    </section>
  );
}
