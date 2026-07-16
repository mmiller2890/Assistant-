import { useCompletion } from "@/hooks";
import { Screenshot } from "./Screenshot";
import { Files } from "./Files";
import { Audio } from "./Audio";
import { Input } from "./Input";

export const Completion = ({ isHidden }: { isHidden: boolean }) => {
  const completion = useCompletion();

  return (
    <>
      <Input {...completion} isHidden={isHidden} />
      {/* Accessory cluster trails the input, hairline-separated — input-centric
          instrument row rather than the fork's interleaved icon pile. */}
      <div className="flex items-center gap-1 border-l border-border pl-1.5">
        <Audio {...completion} />
        <Screenshot {...completion} />
        <Files {...completion} />
      </div>
    </>
  );
};
