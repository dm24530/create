import { Alert, App, Button, Input, InputNumber, Modal, QRCode, Spin } from "antd";
import { Check, CreditCard, RefreshCw, Ticket, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { createCreatePaymentOrder, getCreateCheckoutInfo, redeemCreateCode, type CreateCheckoutInfo, type CreatePaymentOrderResult } from "@/services/create-account";
import { createMe, type CreateSession } from "@/services/create-auth";
import { useUserStore } from "@/stores/use-user-store";

type RechargeTab = "recharge" | "redeem";

const DEFAULT_QUICK_AMOUNTS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

export function CreateRechargeModal({ open, onClose, session }: { open: boolean; onClose: () => void; session: CreateSession | null }) {
    const { message } = App.useApp();
    const [tab, setTab] = useState<RechargeTab>("recharge");
    const [info, setInfo] = useState<CreateCheckoutInfo | null>(null);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [redeeming, setRedeeming] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [pendingPayment, setPendingPayment] = useState<CreatePaymentOrderResult | null>(null);
    const [amount, setAmount] = useState<number | null>(10);
    const [paymentType, setPaymentType] = useState("");
    const [redeemCode, setRedeemCode] = useState("");
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);
    const methods = useMemo(() => Object.values(info?.methods || {}), [info]);
    const currencySymbol = "￥";
    const quickAmounts = useMemo(() => {
        const configured = (info?.recharge_card_products || []).map((product) => Number(product.amount)).filter((value) => Number.isFinite(value) && value > 0);
        return configured.length ? Array.from(new Set(configured)).sort((left, right) => left - right) : DEFAULT_QUICK_AMOUNTS;
    }, [info]);

    const load = async () => {
        if (!session) return;
        setLoading(true);
        setError("");
        try {
            const next = await getCreateCheckoutInfo(session);
            setInfo(next);
            const first = Object.values(next.methods || {})[0];
            setPaymentType((current) => current || first?.payment_type || "");
            setAmount((current) => current && current > 0 ? current : next.recharge_card_products?.[0]?.amount || 10);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "加载充值配置失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        setNotice("");
        setPendingPayment(null);
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, session?.accessToken]);

    const submit = async () => {
        if (!session || !amount || amount <= 0 || !paymentType) {
            setError("请输入充值金额并选择支付方式");
            return;
        }
        setSubmitting(true);
        setError("");
        setNotice("");
        try {
            const order = await createCreatePaymentOrder(session, { amount, paymentType });
            if (order.pay_url) {
                const desktop = (window as Window & { createDesktop?: { openExternal?: (url: string) => Promise<void> } }).createDesktop;
                if (desktop?.openExternal) await desktop.openExternal(order.pay_url);
                else window.open(order.pay_url, "_blank", "noopener,noreferrer");
                message.success("订单已创建，正在打开支付页面");
            } else if (order.qr_code) {
                setPendingPayment(order);
            } else {
                setError("订单已创建，但服务器没有返回支付地址");
            }
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "创建充值订单失败");
        } finally {
            setSubmitting(false);
        }
    };

    const redeem = async () => {
        if (!session || !redeemCode.trim()) {
            setError("请输入兑换码");
            return;
        }
        setRedeeming(true);
        setError("");
        setNotice("");
        try {
            const result = await redeemCreateCode(session, redeemCode);
            setRedeemCode("");
            setNotice(result.message || "兑换成功");
            setUser(await createMe(session));
            message.success(result.message || "兑换成功");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "兑换失败");
        } finally {
            setRedeeming(false);
        }
    };

    const refreshBalance = async () => {
        if (!session) return;
        try {
            setUser(await createMe(session));
            message.success("余额已刷新");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "刷新余额失败");
        }
    };

    const openPaymentTarget = async () => {
        const target = String(pendingPayment?.pay_url || pendingPayment?.qr_code || "").trim();
        if (!target) return;
        const desktop = (window as Window & { createDesktop?: { openExternal?: (url: string) => Promise<void> } }).createDesktop;
        if (desktop?.openExternal) await desktop.openExternal(target);
        else window.open(target, "_blank", "noopener,noreferrer");
    };

    return (
        <>
        <Modal open={open} onCancel={onClose} footer={null} width={980} title={null} styles={{ body: { padding: 0 } }}>
            <div className="border-b border-stone-200 px-5 pt-4 dark:border-stone-800">
                <div className="flex items-center gap-2 pb-3">
                    {([
                        ["recharge", "充值"],
                        ["redeem", "兑换码"],
                    ] as const).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === value ? "bg-stone-200 text-stone-950 dark:bg-stone-800 dark:text-stone-50" : "text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"}`}
                            onClick={() => {
                                setTab(value);
                                setError("");
                                setNotice("");
                            }}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <Spin spinning={loading}>
                <div className="space-y-5 p-6">
                    <div className="flex items-center justify-between gap-4 rounded-xl border border-stone-200 px-5 py-4 dark:border-stone-800">
                        <div className="min-w-0">
                            <span className="text-sm text-stone-500 dark:text-stone-400">充值账户</span>
                            <span className="ml-3 text-base font-semibold text-stone-950 dark:text-stone-100">{user?.display_name || user?.username || "当前账户"}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-emerald-500">
                            <span className="text-sm">当前余额：</span>
                            <span className="text-base font-medium">￥{Number(user?.balance || 0).toFixed(2)}</span>
                            <Button type="text" size="small" icon={<RefreshCw className="size-4" />} aria-label="刷新余额" title="刷新余额" onClick={() => void refreshBalance()} />
                        </div>
                    </div>

                    {info?.recharge_bonus_notice ? <Alert type="info" showIcon message={info.recharge_bonus_notice} /> : null}
                    {info?.balance_disabled ? <Alert type="warning" showIcon message="当前站点已关闭余额充值" /> : null}
                    {error ? <Alert type={error.startsWith("订单已创建") ? "info" : "error"} showIcon message={error} /> : null}
                    {notice ? <Alert type="success" showIcon message={notice} /> : null}

                    {tab === "recharge" ? (
                        <>
                            <section className="rounded-xl border border-stone-200 p-5 dark:border-stone-800">
                                <h3 className="mb-4 text-sm font-medium text-stone-900 dark:text-stone-100">快捷金额</h3>
                                <div className="grid grid-cols-3 gap-3">
                                    {quickAmounts.map((value) => (
                                        <button
                                            key={value}
                                            type="button"
                                            className={`h-14 rounded-lg border text-base transition ${amount === value ? "border-stone-950 bg-stone-100 font-semibold text-stone-950 dark:border-stone-200 dark:bg-stone-800 dark:text-stone-50" : "border-stone-300 text-stone-700 hover:border-stone-500 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-500"}`}
                                            onClick={() => setAmount(value)}
                                        >
                                            ￥{value}
                                        </button>
                                    ))}
                                </div>
                                <label className="mt-5 block text-sm text-stone-600 dark:text-stone-300">
                                    自定义金额
                                    <InputNumber
                                        className="mt-2 w-full"
                                        min={info?.global_min || 1}
                                        max={info?.global_max || undefined}
                                        precision={2}
                                        value={amount}
                                        onChange={setAmount}
                                        controls={false}
                                        prefix={<span className="text-stone-400">{currencySymbol}</span>}
                                        placeholder="输入金额"
                                    />
                                </label>
                            </section>

                            <section className="rounded-xl border border-stone-200 p-5 dark:border-stone-800">
                                <h3 className="mb-4 text-sm font-medium text-stone-900 dark:text-stone-100">支付方式</h3>
                                {methods.length ? (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        {methods.map((method) => {
                                            const selected = paymentType === method.payment_type;
                                            return (
                                                <button
                                                    key={method.payment_type}
                                                    type="button"
                                                    className={`flex h-16 items-center gap-3 rounded-lg border px-5 text-left transition ${selected ? "border-blue-700 bg-blue-950/10 text-blue-700 ring-1 ring-blue-700 dark:border-blue-500 dark:bg-blue-950/30 dark:text-blue-300 dark:ring-blue-500" : "border-stone-300 text-stone-700 hover:border-stone-500 dark:border-stone-700 dark:text-stone-300"}`}
                                                    onClick={() => setPaymentType(method.payment_type)}
                                                >
                                                    <PaymentMethodMark type={method.payment_type} />
                                                    <span className="flex-1 font-medium">{methodLabel(method.payment_type)}</span>
                                                    {selected ? <Check className="size-5 text-blue-600 dark:text-blue-300" /> : null}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="py-5 text-center text-sm text-stone-500">暂无可用支付方式</div>
                                )}
                            </section>

                            <Button
                                type="primary"
                                block
                                size="large"
                                loading={submitting}
                                disabled={Boolean(info?.balance_disabled) || !paymentType || !amount || amount <= 0}
                                onClick={() => void submit()}
                                className="!h-12 !rounded-lg !border-0 !bg-sky-700 !text-base !font-medium hover:!bg-sky-600 disabled:!bg-stone-600"
                            >
                                确认支付 {currencySymbol}{Number(amount || 0).toFixed(2)}
                            </Button>
                        </>
                    ) : (
                        <section className="rounded-xl border border-stone-200 p-5 dark:border-stone-800">
                            <div className="mb-2 flex items-center gap-2 text-base font-medium text-stone-900 dark:text-stone-100">
                                <Ticket className="size-5" />
                                兑换码
                            </div>
                            <p className="mb-4 text-sm text-stone-500 dark:text-stone-400">输入兑换码后，奖励会直接发放到当前账户。</p>
                            <Input
                                value={redeemCode}
                                onChange={(event) => setRedeemCode(event.target.value)}
                                onPressEnter={() => void redeem()}
                                placeholder="请输入兑换码"
                                size="large"
                            />
                            <Button type="primary" block size="large" className="mt-4 !h-12 !rounded-lg !bg-sky-700 hover:!bg-sky-600" loading={redeeming} disabled={!redeemCode.trim()} onClick={() => void redeem()}>
                                立即兑换
                            </Button>
                        </section>
                    )}
                </div>
            </Spin>
        </Modal>

        {pendingPayment && typeof document !== "undefined"
            ? createPortal(
                  <div
                      className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
                      onMouseDown={(event) => {
                          if (event.target === event.currentTarget) setPendingPayment(null);
                      }}
                  >
                      <section className="w-full max-w-[440px] rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl dark:border-stone-700 dark:bg-stone-950">
                          <div className="mb-5 flex items-center justify-between">
                              <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">扫码支付</h2>
                              <button type="button" className="grid size-8 place-items-center rounded-lg text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800" aria-label="关闭" onClick={() => setPendingPayment(null)}>
                                  <X className="size-5" />
                              </button>
                          </div>
                          <div className="flex flex-col items-center gap-5 text-center">
                              <div className="rounded-xl bg-white p-3">
                                  <QRCode value={String(pendingPayment.qr_code || pendingPayment.pay_url || "")} size={240} bordered={false} type="svg" color="#111111" bgColor="#ffffff" />
                              </div>
                              <div>
                                  <div className="text-base font-semibold text-stone-900 dark:text-stone-100">请扫码完成支付</div>
                                  <div className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                                      支付金额 {currencySymbol}{Number(pendingPayment.pay_amount || pendingPayment.amount || amount || 0).toFixed(2)}
                                  </div>
                              </div>
                              <div className="flex w-full gap-2">
                                  <Button className="flex-1" icon={<RefreshCw className="size-4" />} onClick={() => void refreshBalance()}>刷新余额</Button>
                                  <Button type="primary" className="flex-1" onClick={() => void openPaymentTarget()}>打开支付应用</Button>
                              </div>
                          </div>
                      </section>
                  </div>,
                  document.body,
              )
            : null}
        </>
    );
}

function PaymentMethodMark({ type }: { type: string }) {
    if (type === "wxpay" || type.toLowerCase().includes("wechat")) {
        return <span className="grid size-8 place-items-center rounded-full bg-green-500 text-sm font-bold text-white">微</span>;
    }
    if (type === "stripe") {
        return <span className="grid size-8 place-items-center rounded-full bg-indigo-600 text-sm font-bold text-white">S</span>;
    }
    if (type === "alipay") {
        return <span className="grid size-8 place-items-center rounded-full bg-blue-600 text-sm font-bold text-white">支</span>;
    }
    return <span className="grid size-8 place-items-center rounded-full bg-stone-600 text-white"><CreditCard className="size-4" /></span>;
}

function methodLabel(type: string) {
    return ({ alipay: "支付宝", wxpay: "微信支付", easypay: "在线支付", stripe: "Stripe" } as Record<string, string>)[type] || type;
}