import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface AvatarCirclePerson {
  id: string;
  name: string;
  avatar?: string | null;
}

/**
 * A short row of overlapping avatars, after Magic UI's AvatarCircles. Unlike
 * the original it links nowhere and falls back to an initial when a photo is
 * missing or broken. The ring takes the colour of the card behind it, so each
 * circle reads as cut out of the one before it.
 */
export function AvatarCircles({
  people,
  max = 2,
  className,
}: {
  people: AvatarCirclePerson[];
  max?: number;
  className?: string;
}) {
  if (people.length === 0) return null;

  return (
    <span aria-hidden="true" className={cn("flex -space-x-2", className)}>
      {people.slice(0, max).map((person) => (
        <Avatar key={person.id} className="size-6 ring-2 ring-card">
          <AvatarImage src={person.avatar || ""} alt="" />
          <AvatarFallback className="text-[10px]">
            {(person.name || "U")[0].toUpperCase()}
          </AvatarFallback>
        </Avatar>
      ))}
    </span>
  );
}
