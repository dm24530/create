import { Alert, Button, Form, Input } from "antd";
import { LockKeyhole, Mail } from "lucide-react";
import { useState } from "react";

import { createLogin, type CreateSession } from "@/services/create-auth";

type LoginValues = {
    email: string;
    password: string;
};

export function CreateLoginForm({ onAuthenticated }: { onAuthenticated: (session: CreateSession) => void }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const submit = async (values: LoginValues) => {
        setLoading(true);
        setError("");
        try {
            onAuthenticated(await createLogin(values.email, values.password));
            window.location.reload();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "登录失败，请稍后重试");
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="flex min-h-dvh items-center justify-center bg-stone-950 px-5 py-10 text-stone-100">
            <section className="w-full max-w-sm rounded-2xl border border-white/10 bg-stone-900/90 p-7 shadow-2xl shadow-black/30">
                <div className="mb-7">
                    <p className="text-xs font-medium uppercase tracking-[0.22em] text-orange-400">Create Canvas</p>
                    <h1 className="mt-2 text-2xl font-semibold">登录 Create</h1>
                    <p className="mt-2 text-sm leading-6 text-stone-400">使用现有 Create 账号登录。画布项目、素材和生成记录会与云端账号同步。</p>
                </div>
                {error ? <Alert className="mb-5" type="error" showIcon message={error} /> : null}
                <Form<LoginValues> layout="vertical" requiredMark={false} onFinish={submit}>
                    <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email", message: "请输入有效邮箱" }]}>
                        <Input prefix={<Mail className="size-4 text-stone-500" />} autoComplete="email" placeholder="name@example.com" size="large" />
                    </Form.Item>
                    <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
                        <Input.Password prefix={<LockKeyhole className="size-4 text-stone-500" />} autoComplete="current-password" placeholder="输入密码" size="large" />
                    </Form.Item>
                    <Button block htmlType="submit" loading={loading} size="large" type="primary">
                        登录
                    </Button>
                </Form>
            </section>
        </main>
    );
}

