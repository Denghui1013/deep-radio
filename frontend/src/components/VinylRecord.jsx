import { Disc3 } from "lucide-react";

export default function VinylRecord({ coverUrl, title, isActive, isSwitching }) {
  return (
    <div className={`vinyl-scene ${isActive ? "is-active" : ""} ${isSwitching ? "is-switching" : ""}`} aria-hidden="true">
      <div className="vinyl">
        <div className="vinyl-rings" />
        <div className="vinyl-sheen" />
        <div className="vinyl-label">
          {coverUrl ? <img src={coverUrl} alt={title} /> : <Disc3 size={26} />}
        </div>
        <div className="vinyl-spindle" />
      </div>
    </div>
  );
}
