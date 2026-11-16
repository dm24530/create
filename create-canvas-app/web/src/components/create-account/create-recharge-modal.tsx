import { Alert, Button, InputNumber, Modal, Select, Spin } from "antd";
import { CreditCard, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { createCreatePaymentOrder, getCreateCheckoutInfo, type CreateCheckoutInfo } from "@/services/create-account";
import { createMe, type CreateSession } from "@/services/create-auth";
import { useUserStore } from "@/stores/use-user-store";

export function CreateRechargeModal({ open, onClose, session }: { open: boolean; onClose: () => void; session: CreateSession | null }) {
    const [info, setInfo] = useState<CreateCheckoutInfo | null>(null);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [amount, setAmount] = useState<number | null>(5);
    const [paymentType, setPaymentType] = useState("");
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);
    const methods = useMemo(() => Object.values(info?.methods || {}), [info]);
    const methodOptions = methods.map((method) => ({ value: method.payment_type, label: methodLabel(method.payment_type) }));

    const load = async () => {
        if (!session) return;
        setLoading(true);
        setError("");
        try {
            const next = await getCreateCheckoutInfo(session);
            setInfo(next);
            const first = Object.values(next.methods || {})[0];
            setPaymentType((current) => current || first?.payment_type || "");
            if (amount == null && first?.single_min) setAmount(first.single_min);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "加载充值配置失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, session?.accessToken]);

    const submit = async () => {
        if (!session || !amount || amount <= 0 || !paymentType) {
            setError("请输入充值金额并选择支付方式");
            return;
        }
        setSubmitting(true);
        setError("");
        try {
            const order = await createCreatePaymentOrder(session, { amount, paymentType });
            if (order.pay_url) {
                const desktop = (window as Window & { createDesktop?: { openExternal?: (url: string) => Promise<void> } }).createDesktop;
                if (desktop?.openExternal) await desktop.openExternal(order.pay_url);
                else window.open(order.pay_url, "_blank", "noopener,noreferrer");
            } else if (order.qr_code) {
                setError(`订单已创建，请使用支付二维码内容完成支付：${order.qr_code}`);
            } else {
                setError("订单已创建，但服务器没有返回支付地址");
            }
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "创建充值订单失败");
        } finally {
            setSubmitting(false);
        }
    };

    const refreshBalance = async () => {
        if (!session) return;
        try { setUser(await createMe(session)); } catch (cause) { setError(cause instanceof Error ? cause.message : "刷新余额失败"); }
    };

    return (
        <Modal open={open} onCancel={onClose} footer={null} width={620} title="充值">
            <Spin spinning={loading}>
                <div className="space-y-5">
                    <div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                        <div className="text-xs text-stone-500">当前余额</div>
                        <div className="mt-1 text-3xl font-semibold text-emerald-600">${Number(user?.balance || 0).toFixed(2)}</div>
                    </div>
                    {info?.recharge_bonus_notice ? <Alert type="info" showIcon message={info.recharge_bonus_notice} /> : null}
                    {info?.balance_disabled ? <Alert type="warning" showIcon message="当前站点已关闭余额充值" /> : null}
                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="text-sm text-stone-600 dark:text-stone-300">充值金额<InputNumber className="mt-1 w-full" min={info?.global_min || 1} max={info?.global_max || undefined} value={amount} onChange={setAmount} precision={2} /></label>
                        <label className="text-sm text-stone-600 dark:text-stone-300">支付方式<Select className="mt-1 w-full" value={paymentType || undefined} onChange={setPaymentType} options={methodOptions} placeholder="选择支付方式" /></label>
                    </div>
                    {error ? <Alert type={error.startsWith("订单已创建") ? "info" : "error"} showIcon message={error} /> : null}
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button icon={<RefreshCw className="size-4" />} onClick={() => void refreshBalance()}>刷新余额</Button>
                        <Button type="primary" icon={<CreditCard className="size-4" />} loading={submitting} disabled={!paymentType || Boolean(info?.balance_disabled)} onClick={() => void submit()}>去支付 <ExternalLink className="size-4" /></Button>
                    </div>
                </div>
            </Spin>
        </Modal>
    );
}

function methodLabel(type: string) {
    return ({ alipay: "支付宝", wxpay: "微信支付", easypay: "在线支付", stripe: "Stripe" } as Record<string, string>)[type] || type;
}
