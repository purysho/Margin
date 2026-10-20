import { ErrorNote, Loading } from "../components";
import { useApi } from "../hooks";
import { Link } from "../router";
import { FeedbackView, type Receipt } from "./Student";

/** The teacher sees exactly what the student will see on their private link. */
export function PreviewPage({ id }: { id: string }) {
  const { data, error } = useApi<Receipt>(`/submissions/${id}/student-view`);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <p className="tip">
        <strong>Student view.</strong> This is exactly what the student sees on their link.{" "}
        <Link to={`/submissions/${id}`}>Back to editing</Link>
      </p>
      {data.status === "waiting" ? <p className="muted">Nothing released yet: the student sees "Handed in" and a waiting message.</p> : <FeedbackView data={data} />}
    </>
  );
}
