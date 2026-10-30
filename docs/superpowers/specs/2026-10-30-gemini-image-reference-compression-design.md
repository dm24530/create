# Gemini Image Studio Reference Compression Design

## Goal

Allow users to submit exactly 14 reference images to Gemini image generation
without hitting the gateway's inline request-size limit. The implementation
prioritizes successful submission and complete reference-image representation
over preserving every source image at its original resolution.

## Scope

- Apply to Gemini and Gemini-compatible models in `frontend/src/features/image-studio`.
- Keep the visible reference-image cap at 14.
- Compress reference images only for the Gemini request path.
- Preserve the existing multipart path for non-Gemini image edit models.
- Do not change backend request limits or public API contracts.

## Compression Strategy

Add a focused helper module for Gemini reference processing:

- Read each selected `File` into a Blob.
- Downscale the image's long edge proportionally and re-encode as WebP.
  Never crop the image.
- Try progressively smaller profiles until the complete inline-data payload
  fits the client safety budget:
  - `2048px`, quality `0.88`
  - `1600px`, quality `0.86`
  - `1280px`, quality `0.82`
  - `1024px`, quality `0.76`
  - `768px`, quality `0.70`
  - `640px`, quality `0.62`
- Keep every compressed image at or below `1,000,000 bytes`.
- Keep the combined compressed Blob size strictly below `10,000,000 bytes`.
  At 14 images this permits an average of about `714,285 bytes` per image.
- Base64 expansion keeps the final request below the backend's `16 MiB`
  request cap while leaving room for JSON structure, prompts, and transport
  overhead.
- If the smallest profile still exceeds the budget, reject the request before
  sending it and show a direct error explaining that the selected images are
  too complex to submit together.

Compression happens when the user starts Gemini generation, not when files are
first selected. While processing, the UI reports that reference images are
being optimized.

## Reference Selection

Replace the current asynchronous `FileReader` fan-out with an ordered reference
addition queue:

- Serialize additions so rapid consecutive uploads cannot exceed 14 by racing
  the current `references` length.
- Stop at 14 accepted images.
- Surface a warning when files are ignored because of the 14-image cap or an
  unsupported MIME type.

## Request Construction

For Gemini:

- Process the 14 references using the compression helper.
- Build `inlineData` parts from the processed WebP data URLs.
- Keep the reference labels (`图片1` through `图片14`) in the same order.
- Include the processed image count and total encoded byte count in debug-safe
  client diagnostics without logging image data.

For non-Gemini:

- Continue using the existing raw files in multipart edits.

## Error Handling

- Compression failure for an individual image fails before submission with the
  image name included in the message.
- Budget failure fails before submission and tells the user to reduce image
  count or resolution.
- The existing backend size error remains the final fallback.

## Testing

- Unit-test the helper with 14 synthetic reference sources and verify the
  resulting encoded payload stays within the safety budget.
- Unit-test profile fallback when the first profile exceeds the budget.
- Unit-test the final hard failure when every profile exceeds the budget.
- View-test that 14 selected images produce 14 Gemini `inlineData` parts.
- View-test that fast consecutive additions cannot exceed 14 references.
- Run the focused Vitest suite and frontend typecheck.
