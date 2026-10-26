import Boekflow from "./boekflow";

// Vaste slug in deze fase; later bepaalt het domein van de klant de slug.
const SLUG = "taxischiermonnikoog";

export default function Start() {
  return <Boekflow slug={SLUG} />;
}
