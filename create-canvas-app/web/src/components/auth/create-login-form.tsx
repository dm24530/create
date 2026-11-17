import { Alert, Button, Form, Input } from "antd";
import { LockKeyhole, LogIn, Mail } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { createLogin, type CreateSession } from "@/services/create-auth";
import "@/components/auth/create-login-form.css";

type LoginValues = {
    email: string;
    password: string;
};

export function CreateLoginForm({ onAuthenticated }: { onAuthenticated: (session: CreateSession) => void }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const { t } = useTranslation();

    const submit = async (values: LoginValues) => {
        setLoading(true);
        setError("");
        try {
            onAuthenticated(await createLogin(values.email, values.password));
            window.location.reload();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("authPage.loginFailed"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="create-login-shell">
            <aside className="create-login-visual" aria-hidden="true">
                <div className="create-login-visual-image" />
                <div className="create-login-visual-shade" />
                <div className="create-login-visual-content">
                    <div className="create-login-brand">{t("authPage.brand")}</div>

                    <div className="create-login-copy">
                        <p className="create-login-eyebrow">
                            <span />
                            {t("authPage.eyebrow")}
                        </p>
                        <h1>
                            {t("authPage.headlineTop")}
                            <br />
                            <em>{t("authPage.headlineAccent")}</em>
                        </h1>
                        <p>{t("authPage.description")}</p>
                    </div>

                    <div className="create-login-meta">
                        <span>GPT IMAGE</span>
                        <span>SEEDANCE</span>
                        <span>GROK IMAGINE</span>
                    </div>
                </div>
            </aside>

            <section className="create-login-panel">
                <div className="create-login-panel-body">
                    <div className="create-login-form-wrap">
                        <div className="create-login-heading">
                            <h2>{t("authPage.welcomeBack")}</h2>
                            <p>{t("authPage.signInSubtitle")}</p>
                        </div>

                        {error ? <Alert className="create-login-error" type="error" showIcon message={error} /> : null}

                        <Form<LoginValues> className="create-login-form" layout="vertical" requiredMark={false} onFinish={submit}>
                            <Form.Item
                                className="create-login-field"
                                name="email"
                                label={t("authPage.email")}
                                rules={[{ required: true, type: "email", message: t("authPage.invalidEmail") }]}
                            >
                                <Input
                                    autoComplete="email"
                                    autoFocus
                                    prefix={<Mail className="create-login-input-icon" />}
                                    placeholder={t("authPage.emailPlaceholder")}
                                    size="large"
                                />
                            </Form.Item>
                            <Form.Item
                                className="create-login-field"
                                name="password"
                                label={t("authPage.password")}
                                rules={[{ required: true, message: t("authPage.passwordRequired") }]}
                            >
                                <Input.Password
                                    autoComplete="current-password"
                                    prefix={<LockKeyhole className="create-login-input-icon" />}
                                    placeholder={t("authPage.passwordPlaceholder")}
                                    size="large"
                                />
                            </Form.Item>
                            <Button block className="create-login-submit" htmlType="submit" loading={loading} size="large" type="primary">
                                {loading ? null : <LogIn className="size-4" />}
                                <span>{loading ? t("authPage.signingIn") : t("authPage.signIn")}</span>
                            </Button>
                        </Form>
                    </div>

                    <p className="create-login-copyright">{t("authPage.copyright", { year: new Date().getFullYear() })}</p>
                </div>
            </section>
        </main>
    );
}
