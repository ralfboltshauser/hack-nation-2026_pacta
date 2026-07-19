"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileImage,
  FileText,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { type DragEvent, type FormEvent, useRef, useState } from "react";

import { IntakeChat } from "./intake-chat";

const e164Pattern = /^\+[1-9]\d{7,14}$/;
const allowedFileTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const maximumFileBytes = 4_000_000;
const configuredSupplierPhones = (
  process.env.NEXT_PUBLIC_PACTA_DEFAULT_SUPPLIER_PHONES ?? ""
)
  .split(",")
  .map((phone) => phone.trim())
  .filter(Boolean)
  .slice(0, 3);

type DocumentSession = {
  sessionId?: string;
  error?: string;
};

function validateFile(file: File | null) {
  if (!file) return "Choose a PDF or image containing the job details.";
  if (!allowedFileTypes.has(file.type))
    return "Use a PDF, JPEG, PNG, or WebP file.";
  if (file.size === 0) return "The selected file is empty.";
  if (file.size > maximumFileBytes) return "The file must be 4 MB or smaller.";
  return null;
}

function fileSize(bytes: number) {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function DocumentJobFlow({
  initialSessionId,
}: {
  initialSessionId?: string | undefined;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [sessionId, setSessionId] = useState(initialSessionId ?? null);
  const [initialFile, setInitialFile] = useState<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [useCase, setUseCase] = useState<
    "freight_brokerage" | "contractor_bids"
  >("freight_brokerage");
  const [supplierPhones, setSupplierPhones] = useState(
    configuredSupplierPhones.length ? configuredSupplierPhones : [""],
  );
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  if (sessionId) {
    return (
      <IntakeChat
        sessionId={sessionId}
        initialFile={initialFile}
        autoStart={Boolean(initialFile)}
        backHref="/doc-job"
      />
    );
  }

  const normalizedSuppliers = supplierPhones.map((phone) => phone.trim());
  const supplierValidationErrors = normalizedSuppliers.map(
    (phone, index, phones) => {
      if (!e164Pattern.test(phone))
        return "Enter a valid international number, for example +41791234567.";
      if (phones.indexOf(phone) !== index)
        return "Each supplier needs a different phone number.";
      return null;
    },
  );
  const selectedFileError = attempted ? validateFile(file) : null;

  function chooseFile(nextFile: File | null) {
    setFile(nextFile);
    setRequestError(null);
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0] ?? null);
  }

  function updateSupplier(index: number, value: string) {
    setSupplierPhones((phones) =>
      phones.map((phone, phoneIndex) => (phoneIndex === index ? value : phone)),
    );
    setRequestError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setAttempted(true);
    setRequestError(null);
    if (validateFile(file) || supplierValidationErrors.some(Boolean)) return;

    setSubmitting(true);
    try {
      const response = await fetch("/api/doc-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          useCase,
          customer: {
            ...(customerName.trim()
              ? { displayName: customerName.trim() }
              : {}),
          },
          suppliers: normalizedSuppliers.map((phoneE164) => ({ phoneE164 })),
        }),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as DocumentSession | null;
      if (!response.ok)
        throw new Error(payload?.error ?? "The document job could not start.");
      if (!payload?.sessionId)
        throw new Error("The server did not return a session identifier.");

      setInitialFile(file);
      window.history.replaceState(
        null,
        "",
        `/doc-job?session=${encodeURIComponent(payload.sessionId)}`,
      );
      setSessionId(payload.sessionId);
    } catch (error) {
      setRequestError(
        error instanceof Error
          ? error.message
          : "The document job could not start.",
      );
      setSubmitting(false);
    }
  }

  return (
    <main className="doc-job-shell">
      <header className="doc-job-header">
        <Link href="/" aria-label="Back to new negotiation">
          <ArrowLeft size={15} />
        </Link>
        <div className="doc-job-brand">
          <span>
            <Sparkles size={14} />
          </span>
          <strong>Pacta</strong>
        </div>
        <div className="doc-job-safe">
          <ShieldCheck size={14} /> No customer call
        </div>
      </header>

      <section className="doc-job-layout" aria-labelledby="doc-job-title">
        <div className="doc-job-copy">
          <span className="doc-job-eyebrow">Document-first intake</span>
          <h1 id="doc-job-title">Turn a document into a live sourcing job.</h1>
          <p>
            Upload the customer’s brief, load sheet, or request. Pacta extracts
            the job into structured fields and asks only for what is missing.
          </p>

          <ol className="doc-job-steps" aria-label="Document job flow">
            <li>
              <span>1</span>
              <div>
                <strong>Read the source</strong>
                <small>
                  PDF or image, stored privately with integrity checks.
                </small>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Review the extracted job</strong>
                <small>
                  Fill gaps and confirm the exact structured revision.
                </small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Start supplier outreach</strong>
                <small>
                  Calls begin only after your explicit confirmation.
                </small>
              </div>
            </li>
          </ol>

          <div className="doc-job-guarantee">
            <Check size={15} />
            <span>
              <strong>The shipper is not called.</strong>
              The customer side stays in text chat for review and decisions.
            </span>
          </div>
        </div>

        <form className="doc-job-form" onSubmit={submit} noValidate>
          <div className="doc-job-form-title">
            <span>
              <FileText size={17} />
            </span>
            <div>
              <strong>Create from document</strong>
              <small>One source file and up to three suppliers</small>
            </div>
          </div>

          <label
            className={`doc-job-drop${dragging ? " is-dragging" : ""}${selectedFileError ? " is-invalid" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
          >
            <input
              ref={input}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              disabled={submitting}
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            {file ? (
              <>
                <span className="doc-job-file-icon">
                  {file.type === "application/pdf" ? (
                    <FileText size={21} />
                  ) : (
                    <FileImage size={21} />
                  )}
                </span>
                <div>
                  <strong>{file.name}</strong>
                  <small>{fileSize(file.size)} · Ready to extract</small>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    chooseFile(null);
                    if (input.current) input.current.value = "";
                  }}
                >
                  Replace
                </button>
              </>
            ) : (
              <>
                <span className="doc-job-upload-icon">
                  <UploadCloud size={22} />
                </span>
                <div>
                  <strong>Drop a job document here</strong>
                  <small>
                    or click to choose · PDF, JPEG, PNG, WebP · 4 MB
                  </small>
                </div>
              </>
            )}
          </label>
          {selectedFileError && (
            <p className="doc-job-field-error">{selectedFileError}</p>
          )}

          <div className="doc-job-two-fields">
            <label className="doc-job-field">
              <span>Job type</span>
              <select
                value={useCase}
                disabled={submitting}
                onChange={(event) =>
                  setUseCase(
                    event.target.value as
                      "freight_brokerage" | "contractor_bids",
                  )
                }
              >
                <option value="freight_brokerage">Freight shipment</option>
                <option value="contractor_bids">Contractor bid</option>
              </select>
            </label>
            <label className="doc-job-field">
              <span>Customer name · optional</span>
              <input
                type="text"
                autoComplete="name"
                maxLength={100}
                value={customerName}
                placeholder="Acme Logistics"
                disabled={submitting}
                onChange={(event) => setCustomerName(event.target.value)}
              />
            </label>
          </div>

          <fieldset className="doc-job-suppliers">
            <legend>
              <span>Suppliers to contact after confirmation</span>
              <small>{supplierPhones.length} of 3</small>
            </legend>
            <div className="doc-job-supplier-list">
              {supplierPhones.map((phone, index) => (
                <div className="doc-job-supplier" key={index}>
                  <label className="doc-job-field">
                    <span>Supplier {index + 1} phone</span>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="off"
                      value={phone}
                      placeholder="+41791234567"
                      disabled={submitting}
                      aria-invalid={Boolean(
                        attempted && supplierValidationErrors[index],
                      )}
                      onChange={(event) =>
                        updateSupplier(index, event.target.value)
                      }
                    />
                  </label>
                  {supplierPhones.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove supplier ${index + 1}`}
                      disabled={submitting}
                      onClick={() =>
                        setSupplierPhones((phones) =>
                          phones.filter(
                            (_, phoneIndex) => phoneIndex !== index,
                          ),
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                  {attempted && supplierValidationErrors[index] && (
                    <p className="doc-job-field-error">
                      {supplierValidationErrors[index]}
                    </p>
                  )}
                </div>
              ))}
            </div>
            {supplierPhones.length < 3 && (
              <button
                className="doc-job-add-supplier"
                type="button"
                disabled={submitting}
                onClick={() => setSupplierPhones((phones) => [...phones, ""])}
              >
                <Plus size={14} /> Add supplier
              </button>
            )}
          </fieldset>

          {requestError && (
            <p className="doc-job-request-error" role="alert">
              {requestError}
            </p>
          )}

          <button
            className="doc-job-submit"
            type="submit"
            disabled={submitting}
          >
            {submitting ? (
              <>
                <LoaderCircle className="spin" size={16} /> Preparing secure
                intake…
              </>
            ) : (
              <>
                Create job from document <ArrowRight size={16} />
              </>
            )}
          </button>
          <p className="doc-job-submit-note">
            This creates the job workspace and opens text intake. It does not
            place a customer or supplier call yet.
          </p>
        </form>
      </section>
    </main>
  );
}
