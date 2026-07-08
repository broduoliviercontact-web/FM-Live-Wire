// Dexed/WAM spike — preset panel (isolated in features/dexed/).
//
// Reset to default, safe randomize, export the patch as JSON (download), and
// import a JSON patch with simple validation + sanitization (see
// `validatePatch`). UI-only.

import { useRef, useState } from "react";
import { Button } from "../../shared/ui/button";
import {
  DEFAULT_PATCH,
  randomizePatch,
  validatePatch,
  type FmPatch,
} from "./fmPatch";

interface PresetPanelProps {
  readonly patch: FmPatch;
  readonly onPatchChange: (patch: FmPatch) => void;
}

export function PresetPanel({ patch, onPatchChange }: PresetPanelProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function handleExport() {
    try {
      const blob = new Blob([JSON.stringify(patch, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "fm-lab-patch.json";
      a.click();
      URL.revokeObjectURL(url);
      setMessage("Patch exporté (fm-lab-patch.json).");
    } catch {
      setMessage("Échec de l'export.");
    }
  }

  function handleImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      if (typeof text !== "string") {
        setMessage("Fichier illisible.");
        return;
      }
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        setMessage("JSON invalide.");
        return;
      }
      const result = validatePatch(data);
      if (result.ok) {
        onPatchChange(result.patch);
        setMessage("Patch importé.");
      } else {
        setMessage(result.error);
      }
    };
    reader.onerror = () => setMessage("Lecture du fichier impossible.");
    reader.readAsText(file);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onPatchChange(DEFAULT_PATCH);
            setMessage("Patch réinitialisé.");
          }}
        >
          Reset patch
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onPatchChange(randomizePatch());
            setMessage("Patch aléatoire (safe).");
          }}
        >
          Randomize safe
        </Button>
        <Button type="button" variant="outline" onClick={handleExport}>
          Export JSON
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => fileRef.current?.click()}
        >
          Import JSON
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImportFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {message !== null ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}
    </div>
  );
}