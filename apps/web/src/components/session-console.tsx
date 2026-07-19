"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  FileUp,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { LiveSessionConsole } from "./live-session-console";
import { MascotStage } from "./mascot-stage";

const e164Pattern = /^\+[1-9]\d{7,14}$/;
const examplePhoneNumber = "+12025550123";

function SessionLauncher() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [customerPhone, setCustomerPhone] = useState("");
  const [supplierPhones, setSupplierPhones] = useState([""]);
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const normalizedCustomer = customerPhone.trim();
  const normalizedSuppliers = supplierPhones.map((phone) => phone.trim());
  const customerError =
    attempted && !e164Pattern.test(normalizedCustomer)
      ? `Enter a valid E.164 number, for example ${examplePhoneNumber}.`
      : null;
  const supplierValidationErrors = normalizedSuppliers.map(
    (phone, index, phones) => {
      if (!e164Pattern.test(phone))
        return "Enter a valid E.164 number, including the country code.";
      if (phone === normalizedCustomer)
        return "A supplier must use a different number than the customer.";
      if (phones.indexOf(phone) !== index)
        return "Each supplier needs a unique number.";
      return null;
    },
  );
  const supplierErrors = supplierValidationErrors.map((error) =>
    attempted ? error : null,
  );

  const updateSupplier = (index: number, value: string) => {
    setSupplierPhones((phones) =>
      phones.map((phone, phoneIndex) => (phoneIndex === index ? value : phone)),
    );
    setRequestError(null);
  };

  const addSupplier = () => {
    setSupplierPhones((phones) =>
      phones.length < 3 ? [...phones, ""] : phones,
    );
  };

  const removeSupplier = (index: number) => {
    setSupplierPhones((phones) =>
      phones.length > 1
        ? phones.filter((_, phoneIndex) => phoneIndex !== index)
        : phones,
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setAttempted(true);
    setRequestError(null);
    if (
      !e164Pattern.test(normalizedCustomer) ||
      supplierValidationErrors.some(Boolean)
    )
      return;

    setSubmitting(true);
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          useCase: "freight_brokerage",
          customer: { phoneE164: normalizedCustomer },
          suppliers: normalizedSuppliers.map((phoneE164) => ({ phoneE164 })),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        sessionId?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error ?? "The session could not be created.");
      if (!payload?.sessionId)
        throw new Error("The server did not return a session identifier.");
      router.push(
        `/negotiate?session=${encodeURIComponent(payload.sessionId)}`,
      );
    } catch (error) {
      setRequestError(
        error instanceof Error
          ? error.message
          : "The session could not be created.",
      );
      setSubmitting(false);
    }
  };

  return (
    <main className="launcher-shell">
      <header className="launcher-header">
        <div className="brand">
          <span className="brand-mark">
            <Sparkles size={15} />
          </span>
          <span className="brand-copy">
            <strong>Pacta</strong>
            <small>Autonomous negotiation orchestrator</small>
          </span>
        </div>
        <div className="launcher-header-title">New negotiation</div>
        <div className="system-state">
          <span className="realtime-state">
            <i />
            System ready
          </span>
        </div>
      </header>

      <section className="launcher-room" aria-labelledby="launcher-title">
        <motion.div
          className="launcher-hero"
          initial={{ opacity: 0, x: reduceMotion ? 0 : -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{
            duration: reduceMotion ? 0 : 0.24,
            ease: [0.23, 1, 0.32, 1],
          }}
        >
          <div className="launcher-mascot">
            <span className="aura-ring aura-ring-one" aria-hidden="true" />
            <span className="aura-ring aura-ring-two" aria-hidden="true" />
            <MascotStage />
          </div>
          <span className="launcher-eyebrow">
            <i />
            Ready to orchestrate
          </span>
          <h1 id="launcher-title">
            One customer.
            <br />
            The best supplier.
          </h1>
          <p>
            Pacta gathers the job, calls suppliers in parallel, compares every
            offer, and keeps the customer in control.
          </p>
          <div className="launcher-flow" aria-label="Negotiation flow">
            <span>Customer intake</span>
            <ArrowRight size={12} aria-hidden="true" />
            <span>Parallel sourcing</span>
            <ArrowRight size={12} aria-hidden="true" />
            <span>Commitment</span>
          </div>
        </motion.div>

        <motion.form
          className="launcher-form"
          onSubmit={submit}
          noValidate
          initial={{ opacity: 0, x: reduceMotion ? 0 : 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{
            duration: reduceMotion ? 0 : 0.24,
            ease: [0.23, 1, 0.32, 1],
          }}
        >
          <div className="launcher-form-heading">
            <span className="launcher-form-icon" aria-hidden="true">
              <UsersRound size={17} />
            </span>
            <span>
              <strong>Configure the call room</strong>
              <small>Enter one customer and up to three suppliers.</small>
            </span>
          </div>

          <fieldset className="phone-group">
            <legend>Customer</legend>
            <label
              className={
                customerError ? "phone-field is-invalid" : "phone-field"
              }
            >
              <span>Customer phone</span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={examplePhoneNumber}
                value={customerPhone}
                onChange={(event) => {
                  setCustomerPhone(event.target.value);
                  setRequestError(null);
                }}
                aria-invalid={Boolean(customerError)}
                aria-describedby={
                  customerError ? "customer-phone-error" : undefined
                }
                disabled={submitting}
              />
            </label>
            {customerError && (
              <p className="field-error" id="customer-phone-error">
                {customerError}
              </p>
            )}
          </fieldset>

          <fieldset className="phone-group">
            <legend className="phone-group-heading">
              <span>Suppliers</span>
              <small>{supplierPhones.length} of 3</small>
            </legend>
            <div className="supplier-phone-list">
              <AnimatePresence initial={false}>
                {supplierPhones.map((phone, index) => (
                  <motion.div
                    className="supplier-phone-row"
                    key={index}
                    initial={{ opacity: 0, y: reduceMotion ? 0 : 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{
                      duration: reduceMotion ? 0 : 0.18,
                      ease: [0.23, 1, 0.32, 1],
                    }}
                  >
                    <label
                      className={
                        supplierErrors[index]
                          ? "phone-field is-invalid"
                          : "phone-field"
                      }
                    >
                      <span>Supplier {index + 1} phone</span>
                      <input
                        type="tel"
                        inputMode="tel"
                        autoComplete="off"
                        placeholder={examplePhoneNumber}
                        value={phone}
                        onChange={(event) =>
                          updateSupplier(index, event.target.value)
                        }
                        aria-invalid={Boolean(supplierErrors[index])}
                        aria-describedby={
                          supplierErrors[index]
                            ? `supplier-${index}-phone-error`
                            : undefined
                        }
                        disabled={submitting}
                      />
                    </label>
                    {supplierPhones.length > 1 && (
                      <button
                        className="remove-supplier"
                        type="button"
                        onClick={() => removeSupplier(index)}
                        aria-label={`Remove supplier ${index + 1}`}
                        disabled={submitting}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    {supplierErrors[index] && (
                      <p
                        className="field-error"
                        id={`supplier-${index}-phone-error`}
                      >
                        {supplierErrors[index]}
                      </p>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            {supplierPhones.length < 3 && (
              <button
                className="add-supplier"
                type="button"
                onClick={addSupplier}
                disabled={submitting}
              >
                <Plus size={14} />
                Add supplier
              </button>
            )}
          </fieldset>

          {requestError && (
            <div className="launcher-error" role="alert">
              {requestError}
            </div>
          )}

          <button className="start-session" type="submit" disabled={submitting}>
            <span>
              {submitting ? "Starting negotiation…" : "Start negotiation"}
            </span>
            {submitting ? (
              <LoaderCircle className="launcher-spinner" size={16} />
            ) : (
              <ArrowRight size={16} />
            )}
          </button>
          <p className="launcher-disclaimer">
            Starting creates the session and begins customer intake.
          </p>
          <div className="launcher-alternative">
            <span>or</span>
            <Link href="/doc-job">
              <FileUp size={14} /> Start from a document—no customer call
            </Link>
          </div>
        </motion.form>
      </section>
    </main>
  );
}

export function SessionConsole({
  sessionId,
}: {
  sessionId?: string | undefined;
}) {
  return sessionId ? (
    <LiveSessionConsole sessionId={sessionId} />
  ) : (
    <SessionLauncher />
  );
}
