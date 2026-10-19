/** Matches the product page's two-column geometry while Postgres answers. */
export default function ProductLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:py-12">
      <div className="skeleton mb-8 h-4 w-72 max-w-full rounded" />
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-14">
        <div className="skeleton aspect-square rounded-2xl" />
        <div className="flex flex-col gap-4">
          <div className="skeleton h-3 w-24 rounded" />
          <div className="skeleton h-9 w-4/5 rounded" />
          <div className="skeleton mt-2 h-10 w-40 rounded" />
          <div className="skeleton h-8 w-52 rounded-full" />
          <div className="mt-4 flex flex-col gap-2">
            <div className="skeleton h-4 w-full rounded" />
            <div className="skeleton h-4 w-full rounded" />
            <div className="skeleton h-4 w-2/3 rounded" />
          </div>
          <div className="skeleton mt-4 h-14 w-56 rounded-xl" />
          <div className="skeleton mt-8 h-40 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
