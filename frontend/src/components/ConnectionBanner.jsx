export default function ConnectionBanner({ socketStatus }) {
  if (socketStatus === "connected") return null;
  return <div className="connection-banner">Socket: {socketStatus}</div>;
}
