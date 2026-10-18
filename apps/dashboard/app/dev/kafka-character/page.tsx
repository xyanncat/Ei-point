import type { Metadata } from "next";
import { KafkaPreview } from "../../../components/kafka3d/preview";

export const metadata: Metadata = {
  title: "Kafka 3D character — development preview",
  robots: { index: false, follow: false },
};

export default function KafkaCharacterPreviewPage() {
  return <KafkaPreview />;
}
