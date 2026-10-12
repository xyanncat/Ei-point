import { PageArt } from "../../components/page-art";
import { ServiceCatalog } from "../../components/service-catalog";
export default function ServicesPage() {
  return (
    <section aria-label="Game services">
      <div className="ei-page-layout">
        <div className="ei-page-body">
          <p>Game services</p>
          <h1>
            Make your
            <br />
            next move.
          </h1>
          <p className="lede">
            Quest progression, exploration and character builds from the
            original Ei Paradise catalog. Choose a game and find the support
            your account needs.
          </p>
          <div className="clip-panel">
            <h2>Original services, preserved</h2>
            <p>
              These service definitions and INR prices come from the supplied
              archive. Staff confirm availability and the final order before
              payment.
            </p>
            <a className="ei-action" href="#catalog">
              Browse all services
            </a>
          </div>
        </div>
        <PageArt src="/art/kafka-tea.png" caption="The next move is yours." />
      </div>
      <div id="catalog">
        <ServiceCatalog />
      </div>
    </section>
  );
}
