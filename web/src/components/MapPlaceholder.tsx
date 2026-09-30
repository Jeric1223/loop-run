/** 카카오맵 SDK 연동 전까지 쓰는 회색 지도 자리 */
export function MapPlaceholder({ className = "" }: { className?: string }) {
  return (
    <div className={`map-ph ${className}`} aria-hidden="true">
      <span className="map-tag">카카오맵 SDK 영역</span>
    </div>
  );
}
