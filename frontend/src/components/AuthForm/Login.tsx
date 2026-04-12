import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { useForm } from "react-hook-form";
import { formLoginScheme } from "./scheme";
import { zodResolver } from "@hookform/resolvers/zod";
import type z from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { loginAPI } from "@/redux/slices/userSlice";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import { useNavigate } from "react-router";
import { toast } from "sonner";

const Login = () => {
  const form = useForm<z.infer<typeof formLoginScheme>>({
    resolver: zodResolver(formLoginScheme),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();

  const onSubmit = async (data: z.infer<typeof formLoginScheme>) => {
    try {
      await dispatch(loginAPI(data)).unwrap();
      navigate("/");
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : (error as { message?: string })?.message;

      if (
        message === "Tài khoản chưa kích hoạt. Vui lòng xác thực OTP" ||
        message === "Tài khoản chưa kích hoạt"
      ) {
        toast.info("Vui lòng xác thực OTP trước khi đăng nhập");
        navigate("/verify-otp", { state: { email: data.email } });
      }
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input placeholder="Nhập email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="space-y-2">
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mật khẩu</FormLabel>
                <FormControl>
                  <Input placeholder="******" {...field} type="password" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <Button type="submit" className="w-full">
          Đăng nhập
        </Button>
      </form>
    </Form>
  );
};

export default Login;
